import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LACE_EXTENSION_DIR_ENV,
  LACE_ROLE_LABELS_JSON_ENV,
  RealLaceProfileDriver,
  createRealLaceProfileDriverFromEnv,
  unlockLacePage,
} from "./real-lace-driver.mjs";

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { force: true, recursive: true });
  }
});

describe("real Lace profile driver", () => {
  it("fails closed when the unpacked extension directory is missing", async () => {
    await expect(
      createRealLaceProfileDriverFromEnv({
        env: {
          PW_USER_DATA_DIR: "/tmp/profile",
          PREPROD_TEST_WALLETS_FILE: "/tmp/wallets.local.json",
        },
      }),
    ).rejects.toMatchObject({
      code: "reclaim_e2e_lace_extension_dir_missing",
    });
  });

  it("launches a persistent headed profile with only the configured Lace extension", async () => {
    const repo = tempDir();
    const extensionDir = path.join(repo, "lace-extension");
    const userDataDir = path.join(repo, "lace-profile");
    const walletPath = path.join(repo, "wallets.local.json");
    mkdirSync(extensionDir, { recursive: true });
    writeFileSync(path.join(extensionDir, "manifest.json"), JSON.stringify({ manifest_version: 3 }), "utf8");
    writeFileSync(walletPath, JSON.stringify(validWalletFile()), "utf8");

    const driver = await createRealLaceProfileDriverFromEnv({
      env: {
        [LACE_EXTENSION_DIR_ENV]: extensionDir,
        [LACE_ROLE_LABELS_JSON_ENV]: JSON.stringify({
          reclaim_funder: "Proof Tool Preprod Funder",
        }),
        PW_USER_DATA_DIR: userDataDir,
        PREPROD_TEST_WALLETS_FILE: walletPath,
      },
      cwd: repo,
      repoRoot: repo,
      deriveRoleState,
    });

    const calls = [];
    const context = await driver.launchBrowserContext(
      {
        async launchPersistentContext(profileDir, options) {
          calls.push({ profileDir, options });
          return fakeExtensionContext();
        },
      },
      { headless: true },
    );

    expect(context.serviceWorkers()).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].profileDir).toBe(userDataDir);
    expect(calls[0].options.headless).toBe(false);
    expect(calls[0].options.args).toEqual([
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ]);
    expect(driver.extensionId).toBe("laceextensionid");
  });

  it("keeps mnemonic material out of the public driver summary", async () => {
    const repo = tempDir();
    const extensionDir = path.join(repo, "lace-extension");
    const walletPath = path.join(repo, "wallets.local.json");
    const walletFile = validWalletFile();
    mkdirSync(extensionDir, { recursive: true });
    writeFileSync(path.join(extensionDir, "manifest.json"), JSON.stringify({ manifest_version: 3 }), "utf8");
    writeFileSync(walletPath, JSON.stringify(walletFile), "utf8");

    const driver = await createRealLaceProfileDriverFromEnv({
      env: {
        [LACE_EXTENSION_DIR_ENV]: extensionDir,
        PW_USER_DATA_DIR: path.join(repo, "lace-profile"),
        PREPROD_TEST_WALLETS_FILE: walletPath,
      },
      cwd: repo,
      repoRoot: repo,
      deriveRoleState,
    });

    const summaryText = JSON.stringify(driver.summary);
    expect(summaryText).not.toContain(walletFile.reclaim_funder.mnemonic);
    expect(summaryText).toContain("reclaim_funder");
    expect(await driver.recoveryPhraseForBrowserUi("reclaim_funder")).toBe(walletFile.reclaim_funder.mnemonic);
  });

  it("refuses any signing request for the compromised role", async () => {
    const compromised = deriveRoleState({
      role: "compromised_user",
      mnemonic: words("cable", 12),
      label: "compromised_user",
    });
    const driver = new RealLaceProfileDriver({
      browserChannel: "chromium",
      extensionDir: "/tmp/lace",
      extensionRoute: "popup.html",
      manifestPath: "/tmp/lace/manifest.json",
      providerId: "lace",
      providerName: "Lace",
      roleLabels: { compromised_user: "compromised_user" },
      roleStates: new Map([["compromised_user", compromised]]),
      userDataDir: "/tmp/profile",
      walletPassword: "test-password",
    });

    await expect(driver.approveWalletSigning("compromised_user", "claim")).rejects.toMatchObject({
      code: "unexpected_compromised_wallet_signature",
    });
  });

  it("selects the Lace 2.1.1 DApp account by label before authorizing", async () => {
    const compromised = deriveRoleState({
      role: "compromised_user",
      mnemonic: words("cable", 12),
      label: "compromised_user",
    });
    const driver = new RealLaceProfileDriver({
      browserChannel: "chromium",
      extensionDir: "/tmp/lace",
      extensionRoute: "expo/index.html",
      manifestPath: "/tmp/lace/manifest.json",
      providerId: "lace",
      providerName: "Lace",
      roleLabels: { compromised_user: "compromised_user" },
      roleStates: new Map([["compromised_user", compromised]]),
      userDataDir: "/tmp/profile",
      walletPassword: "test-password",
    });
    const { context, clicks } = fakeLaceDappConnectContext("compromised_user");
    driver.context = context;
    driver.extensionId = "laceextensionid";

    await driver.approveDappConnection("compromised_user", {
      beforeApprove: async () => clicks.push("before-authorize"),
    });

    expect(clicks).toEqual([
      "dropdown",
      "account:compromised_user",
      "before-authorize",
      "authorize",
    ]);
  });

  it("accepts an already-authorized safe account only after verifying the active DApp role", async () => {
    const safe = deriveRoleState({
      role: "safe_claim_destination",
      mnemonic: words("delta", 12),
      label: "safe_claim_dest",
    });
    const driver = new RealLaceProfileDriver({
      browserChannel: "chromium",
      extensionDir: "/tmp/lace",
      extensionRoute: "expo/index.html",
      manifestPath: "/tmp/lace/manifest.json",
      providerId: "lace",
      providerName: "Lace",
      roleLabels: { safe_claim_destination: "safe_claim_dest" },
      roleStates: new Map([["safe_claim_destination", safe]]),
      userDataDir: "/tmp/profile",
      walletPassword: "test-password",
    });
    const page = {
      url: () => "chrome-extension://laceextensionid/expo/index.html",
      isClosed: () => false,
      locator() {
        const locator = {
          first: () => locator,
          filter: () => locator,
          isVisible: async () => false,
        };
        return locator;
      },
    };
    driver.context = { pages: () => [page] };
    driver.extensionId = "laceextensionid";
    const verified = [];
    driver.assertActiveDappRole = async (_page, role) => verified.push(role);

    const result = await driver.approveDappConnection("safe_claim_destination", {
      allowAlreadyAuthorized: true,
      dappPage: {},
    });

    expect(result).toBeNull();
    expect(verified).toEqual(["safe_claim_destination"]);
  });

  it("reports a rejected persisted password as an unlock failure", async () => {
    const page = fakeRejectedUnlockPage();

    await expect(unlockLacePage(page, "wrong-password")).rejects.toMatchObject({
      code: "lace_unlock_failed",
    });
    expect(page.filledPasswords).toEqual(["wrong-password"]);
  });
});

function validWalletFile() {
  return {
    deployer: { mnemonic: words("able", 12) },
    reclaim_funder: { mnemonic: words("baker", 12) },
    compromised_user: { mnemonic: words("cable", 12) },
    safe_claim_destination: { mnemonic: words("delta", 12) },
  };
}

function words(prefix, count) {
  const suffixes = [
    "abandon",
    "baker",
    "cable",
    "delta",
    "eager",
    "fable",
    "gather",
    "harbor",
    "island",
    "jacket",
    "kitten",
    "ladder",
  ];
  return suffixes.slice(0, count).map((suffix) => `${prefix}${suffix}`).join(" ");
}

function deriveRoleState({ role, mnemonic, label }) {
  return {
    role,
    label,
    mnemonic,
    address: `addr_test1${role}`,
    addressHex: `hex-${role}`,
    rewardAddress: null,
    rewardAddressHex: null,
    paymentCredential: "a".repeat(56),
    stakeCredential: null,
    canSign: role !== "compromised_user",
  };
}

function fakeExtensionContext() {
  return {
    serviceWorkers() {
      return [
        {
          url() {
            return "chrome-extension://laceextensionid/background.js";
          },
        },
      ];
    },
  };
}

function fakeLaceDappConnectContext(accountLabel) {
  const clicks = [];
  let dropdownOpen = false;
  const page = {
    url() {
      return "chrome-extension://laceextensionid/expo/index.html#/cardano-dapp-connect";
    },
    isClosed() {
      return false;
    },
    locator(selector) {
      const makeLocator = (kind, hasText = null) => ({
        first() {
          return makeLocator(kind, hasText);
        },
        filter(options) {
          return makeLocator(kind, options.hasText);
        },
        async isVisible() {
          if (kind === "dropdown" || kind === "authorize") return true;
          if (kind === "account") return dropdownOpen && hasText === accountLabel;
          return false;
        },
        async click() {
          if (kind === "dropdown") {
            dropdownOpen = true;
            clicks.push("dropdown");
          } else if (kind === "account") {
            clicks.push(`account:${hasText}`);
          } else if (kind === "authorize") {
            clicks.push("authorize");
          }
        },
      });
      if (selector === '[data-testid="dropdown-button"]') return makeLocator("dropdown");
      if (selector === '[data-testid="dapp-connector-primary-button"]') return makeLocator("authorize");
      if (selector === '[data-testid^="dropdown-menu-item-"]') return makeLocator("account");
      return makeLocator("missing");
    },
  };
  return {
    clicks,
    context: {
      pages() {
        return [page];
      },
    },
  };
}

function fakeRejectedUnlockPage() {
  const page = {
    filledPasswords: [],
    locator(selector) {
      const locator = {
        first() {
          return locator;
        },
        async isVisible() {
          return selector === '[data-testid="authentication-prompt-input-value"]';
        },
        async fill(value) {
          page.filledPasswords.push(value);
        },
        async click() {},
        async waitFor() {
          if (selector === '[data-testid="authentication-prompt-body"]') {
            throw new Error("prompt remained visible");
          }
        },
      };
      return locator;
    },
    async waitForTimeout() {},
  };
  return page;
}

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "proof-tool-real-lace-driver-"));
  tempDirs.push(dir);
  return dir;
}
