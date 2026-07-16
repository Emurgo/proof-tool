import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveGitHubVercelPreview,
  validateVercelPreviewOrigin,
  writeGitHubOutput,
} from "./resolve-github-vercel-preview.mjs";

const sha = "a".repeat(40);
const repository = "example/proof-tool";
const previewUrl = "https://proof-tool-c4f3n2-example.vercel.app/";
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("GitHub Vercel Preview resolver", () => {
  it("resolves the latest successful Preview status for the exact commit", async () => {
    const fetchFn = sequenceFetch([
      [deployment({ id: 17 })],
      [status({ id: 9, state: "pending", createdAt: "2026-07-15T09:59:00Z" }), status({ id: 8 })],
    ]);

    const result = await resolveGitHubVercelPreview({ repository, sha, token: "token", fetchFn });

    expect(result).toEqual({ deploymentId: "17", environment: "Preview", sha, url: previewUrl });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe("Bearer token");
  });

  it("polls until the deployment becomes successful", async () => {
    let deploymentRequests = 0;
    const fetchFn = vi.fn(async (url) => {
      if (new URL(url).pathname.endsWith("/deployments")) {
        deploymentRequests += 1;
        return response([deployment({ id: 17 })]);
      }
      return response([
        status({
          id: deploymentRequests,
          state: deploymentRequests === 1 ? "pending" : "success",
          environmentUrl: deploymentRequests === 1 ? null : previewUrl,
        }),
      ]);
    });
    let clock = 0;
    const sleep = vi.fn(async (milliseconds) => {
      clock += milliseconds;
    });

    const result = await resolveGitHubVercelPreview({
      repository,
      sha,
      token: "token",
      fetchFn,
      now: () => clock,
      sleep,
      timeoutMs: 100,
      pollIntervalMs: 10,
    });

    expect(result.url).toBe(previewUrl);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("fails closed when more than one matching project deployment succeeds", async () => {
    const fetchFn = sequenceFetch([
      [deployment({ id: 17 }), deployment({ id: 18 })],
      [status({ environmentUrl: previewUrl })],
      [status({ environmentUrl: "https://proof-tool-other-example.vercel.app/" })],
    ]);

    await expect(resolveGitHubVercelPreview({ repository, sha, token: "token", fetchFn })).rejects.toMatchObject({
      code: "preview_deployment_ambiguous",
    });
  });

  it("ignores non-Preview, stale-commit, pending, and production deployments", async () => {
    const fetchFn = sequenceFetch([
      [
        deployment({ id: 1, environment: "Production" }),
        deployment({ id: 2, deploymentSha: "b".repeat(40) }),
        deployment({ id: 3 }),
        deployment({ id: 4 }),
      ],
      [status({ state: "pending", environmentUrl: previewUrl })],
      [status({ environmentUrl: "https://proof-tool.vercel.app/" })],
    ]);

    await expect(
      resolveGitHubVercelPreview({ repository, sha, token: "token", fetchFn, timeoutMs: 0 }),
    ).rejects.toMatchObject({ code: "preview_deployment_not_ready" });
  });

  it("requires an exact non-production Vercel project origin", () => {
    expect(validateVercelPreviewOrigin(previewUrl)).toBe(previewUrl);
    expect(() => validateVercelPreviewOrigin("https://proof-tool.vercel.app/")).toThrowError(
      expect.objectContaining({ code: "preview_url_invalid" }),
    );
    expect(() => validateVercelPreviewOrigin("https://other-project-example.vercel.app/")).toThrowError(
      expect.objectContaining({ code: "preview_url_invalid" }),
    );
    expect(() => validateVercelPreviewOrigin(`${previewUrl}claim`)).toThrowError(
      expect.objectContaining({ code: "preview_url_invalid" }),
    );
  });

  it("writes only single-line GitHub outputs", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "proof-tool-preview-output-"));
    tempDirs.push(dir);
    const output = path.join(dir, "github-output");

    writeGitHubOutput(output, "preview_url", previewUrl);
    expect(readFileSync(output, "utf8")).toBe(`preview_url=${previewUrl}\n`);
    expect(() => writeGitHubOutput(output, "preview_url", "safe\nunsafe=true")).toThrowError(
      expect.objectContaining({ code: "github_output_invalid" }),
    );
  });
});

function deployment({ id, environment = "Preview", deploymentSha = sha }) {
  return { id, environment, sha: deploymentSha };
}

function status({
  id = 8,
  state = "success",
  environmentUrl = previewUrl,
  createdAt = "2026-07-15T10:00:00Z",
} = {}) {
  return { id, state, environment_url: environmentUrl, created_at: createdAt };
}

function response(payload, statusCode = 200) {
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    async json() {
      return payload;
    },
  };
}

function sequenceFetch(payloads) {
  const queue = [...payloads];
  return vi.fn(async () => response(queue.shift()));
}
