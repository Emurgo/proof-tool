import {
  CheckCircle2,
  CircleStop,
  ExternalLink,
  FolderKey,
  Loader2,
  Power,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import type { DesktopApi, HelperStartup, KeyBundleProgress, KeyBundleStatus } from "./desktopApi";
import { tauriDesktopApi } from "./desktopApi";

type AppProps = {
  api?: DesktopApi;
};

const defaultSiteURL = import.meta.env.VITE_PROOF_SITE_URL ?? "http://127.0.0.1:3002";
const defaultSidecarPath = import.meta.env.VITE_PROOF_HELPER_SIDECAR_PATH ?? "";

export function App({ api = tauriDesktopApi }: AppProps) {
  const [keyStatus, setKeyStatus] = useState<KeyBundleStatus | null>(null);
  const [helperRunning, setHelperRunning] = useState(false);
  const [startup, setStartup] = useState<HelperStartup | null>(null);
  const [siteUrl, setSiteUrl] = useState(defaultSiteURL);
  const [sidecarPath, setSidecarPath] = useState(defaultSidecarPath);
  const [bundleSourceDir, setBundleSourceDir] = useState("");
  const [trustedManifestKey, setTrustedManifestKey] = useState("");
  const [signatureKeyId, setSignatureKeyId] = useState("proof-helper-release-v1");
  const [fixture, setFixture] = useState(false);
  const [devCreateKeys, setDevCreateKeys] = useState(false);
  const [busy, setBusy] = useState<"status" | "start" | "stop" | "install" | "delete" | null>("status");
  const [message, setMessage] = useState("");
  const [installProgress, setInstallProgress] = useState<KeyBundleProgress | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);

  const keyTone = useMemo(() => toneForKey(keyStatus), [keyStatus]);
  const helperTone = helperRunning ? "ok" : busy === "start" ? "warn" : "idle";

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void api
      .onKeyBundleProgress((progress) => {
        if (active) {
          setInstallProgress(progress);
        }
      })
      .then((nextUnlisten) => {
        if (active) {
          unlisten = nextUnlisten;
        } else {
          nextUnlisten();
        }
      })
      .catch((error) => {
        if (active) {
          setMessage(messageFor(error));
        }
      });
    void refresh();
    void api.helperProcessStatus().then((status) => {
      if (active) {
        setHelperRunning(status.running);
      }
    });
    return () => {
      active = false;
      unlisten?.();
    };

    async function refresh() {
      try {
        const status = await api.keyStatus();
        if (active) {
          setKeyStatus(status);
          setMessage("");
        }
      } catch (error) {
        if (active) {
          setMessage(messageFor(error));
        }
      } finally {
        if (active) {
          setBusy(null);
        }
      }
    }
  }, [api]);

  const refreshStatus = async () => {
    setBusy("status");
    setMessage("");
    try {
      const [nextKeyStatus, process] = await Promise.all([api.keyStatus(), api.helperProcessStatus()]);
      setKeyStatus(nextKeyStatus);
      setHelperRunning(process.running);
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy("start");
    setMessage("");
    try {
      const next = await api.startHelper({
        siteUrl,
        sidecarPath: sidecarPath.trim() || undefined,
        fixture,
        devCreateKeys,
      });
      setStartup(next);
      setHelperRunning(true);
      await api.openUrl(next.pairing_url);
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy("stop");
    setMessage("");
    try {
      await api.stopHelper();
      setHelperRunning(false);
      setStartup(null);
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  const deleteCache = async () => {
    setBusy("delete");
    setMessage("");
    setInstallProgress(null);
    try {
      const next = await api.deleteKeyCache();
      setKeyStatus(next);
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  const installBundle = async () => {
    setBusy("install");
    setMessage("");
    setCancelRequested(false);
    setInstallProgress(null);
    try {
      const next = await api.activateKeyBundle({
        sourceDir: bundleSourceDir,
        trustedManifestPublicKeyHex: trustedManifestKey,
        expectedSignatureKeyId: signatureKeyId,
        minFreeBytes: 1,
      });
      setKeyStatus(next);
      setMessage("Key bundle installed and verified.");
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  const cancelInstall = async () => {
    setCancelRequested(true);
    setMessage("");
    try {
      await api.cancelKeyBundleActivation();
    } catch (error) {
      setMessage(messageFor(error));
      setCancelRequested(false);
    }
  };

  const openWebsite = async () => {
    if (!startup) {
      return;
    }
    await api.openUrl(startup.pairing_url);
  };

  return (
    <main className="app-shell">
      <aside className="status-rail" aria-label="Proof Helper status">
        <div className="brand-block">
          <FolderKey size={28} />
          <div>
            <h1>Proof Helper</h1>
            <p>Local prover control</p>
          </div>
        </div>
        <StatusLine label="Key bundle" value={labelForKey(keyStatus)} tone={keyTone} />
        <StatusLine label="Sidecar" value={helperRunning ? "Running" : "Stopped"} tone={helperTone} />
        <StatusLine label="Pairing" value={startup ? "Ready" : "Not paired"} tone={startup ? "ok" : "idle"} />
        <StatusLine label="Protocol" value={startup?.protocol_version ?? "proof-helper-v1"} tone="idle" />
      </aside>

      <section className="workspace" aria-label="Proof Helper controls">
        <header className="workspace-header">
          <div>
            <h2>Desktop Helper</h2>
            <p>{keyStatus?.active_dir ?? "Checking Proof Helper app data"}</p>
          </div>
          <button className="icon-button" type="button" onClick={refreshStatus} aria-label="Refresh status">
            {busy === "status" ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
        </header>

        <div className="work-grid">
          <section className="work-section" aria-labelledby="key-heading">
            <div className="section-heading">
              <h3 id="key-heading">Key Cache</h3>
              <StatusBadge tone={keyTone}>{labelForKey(keyStatus)}</StatusBadge>
            </div>
            <dl className="details">
              <Detail label="Version" value={keyStatus?.key_version ?? "Unavailable"} />
              <Detail label="VK hash" value={shortHash(keyStatus?.vk_hash)} />
              <Detail label="Circuit" value={keyStatus?.circuit_id ?? "Unavailable"} />
              <Detail label="App data" value={keyStatus?.app_data_dir ?? "Checking"} />
            </dl>
            <label className="field">
              <span>Bundle source</span>
              <input
                value={bundleSourceDir}
                onChange={(event) => setBundleSourceDir(event.target.value)}
                placeholder="Directory with manifest.json and key files"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Manifest public key</span>
              <input
                value={trustedManifestKey}
                onChange={(event) => setTrustedManifestKey(event.target.value)}
                placeholder="64 hex characters"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Signature key id</span>
              <input
                value={signatureKeyId}
                onChange={(event) => setSignatureKeyId(event.target.value)}
                spellCheck={false}
              />
            </label>
            <div className="button-row">
              <button
                className="primary-button"
                type="button"
                onClick={installBundle}
                disabled={busy === "install" || bundleSourceDir.trim() === "" || trustedManifestKey.trim() === ""}
              >
                {busy === "install" ? <Loader2 className="spin" size={17} /> : <FolderKey size={17} />}
                Install key
              </button>
              {busy === "install" ? (
                <button className="secondary-button" type="button" onClick={cancelInstall} disabled={cancelRequested}>
                  {cancelRequested ? <Loader2 className="spin" size={17} /> : <CircleStop size={17} />}
                  Cancel install
                </button>
              ) : null}
              <button
                className="secondary-button"
                type="button"
                onClick={deleteCache}
                disabled={busy === "delete" || busy === "install"}
              >
                {busy === "delete" ? <Loader2 className="spin" size={17} /> : <Trash2 size={17} />}
                Remove cache
              </button>
            </div>
            {busy === "install" || installProgress ? <InstallProgressView progress={installProgress} /> : null}
          </section>

          <section className="work-section" aria-labelledby="helper-heading">
            <div className="section-heading">
              <h3 id="helper-heading">Website Pairing</h3>
              <StatusBadge tone={helperTone}>{helperRunning ? "Running" : "Stopped"}</StatusBadge>
            </div>
            <label className="field">
              <span>Website URL</span>
              <input value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} spellCheck={false} />
            </label>
            <label className="field">
              <span>Sidecar path</span>
              <input
                value={sidecarPath}
                onChange={(event) => setSidecarPath(event.target.value)}
                placeholder="Bundled sidecar or PROOF_HELPER_SIDECAR_PATH"
                spellCheck={false}
              />
            </label>
            <div className="toggle-row">
              <label>
                <input type="checkbox" checked={fixture} onChange={(event) => setFixture(event.target.checked)} />
                Fixture
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={devCreateKeys}
                  onChange={(event) => setDevCreateKeys(event.target.checked)}
                />
                Dev keys
              </label>
            </div>
            <div className="button-row">
              <button className="primary-button" type="button" onClick={connect} disabled={busy === "start"}>
                {busy === "start" ? <Loader2 className="spin" size={17} /> : <ExternalLink size={17} />}
                Connect
              </button>
              <button className="secondary-button" type="button" onClick={stop} disabled={!helperRunning || busy === "stop"}>
                {busy === "stop" ? <Loader2 className="spin" size={17} /> : <Power size={17} />}
                Stop
              </button>
              {startup ? (
                <button className="secondary-button" type="button" onClick={openWebsite}>
                  <ExternalLink size={17} />
                  Open website
                </button>
              ) : null}
            </div>
          </section>
        </div>

        <section className="event-strip" aria-live="polite">
          {message ? (
            <StateMessage tone="bad" text={message} />
          ) : startup ? (
            <StateMessage tone="ok" text={`Paired at ${startup.helper_url}`} />
          ) : keyStatus?.error ? (
            <StateMessage tone="warn" text={keyStatus.error} />
          ) : (
            <StateMessage tone="idle" text="Ready for local helper control." />
          )}
        </section>
      </section>
    </main>
  );
}

function InstallProgressView({ progress }: { progress: KeyBundleProgress | null }) {
  const percent = progressPercent(progress);
  return (
    <div className="progress-block" aria-label="Key bundle activation progress">
      <div>
        <span>{progress ? `Staging ${progress.file_name}` : "Preparing key bundle"}</span>
        <strong>{percent === null ? "Starting" : `${percent}%`}</strong>
      </div>
      <progress value={percent ?? 0} max={100} />
    </div>
  );
}

function StatusLine({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className="status-line">
      <i className={`dot ${tone}`} aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function StatusBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StateMessage({ tone, text }: { tone: Tone; text: string }) {
  const Icon = tone === "bad" ? ShieldAlert : CheckCircle2;
  return (
    <div className={`state-message ${tone}`}>
      <Icon size={18} />
      <span>{text}</span>
    </div>
  );
}

type Tone = "ok" | "warn" | "bad" | "idle";

function toneForKey(status: KeyBundleStatus | null): Tone {
  if (!status) {
    return "idle";
  }
  if (status.ready) {
    return "ok";
  }
  if (status.state === "missing") {
    return "warn";
  }
  return "bad";
}

function labelForKey(status: KeyBundleStatus | null) {
  if (!status) {
    return "Checking";
  }
  switch (status.state) {
    case "ready":
      return "Ready";
    case "missing":
      return "Missing";
    case "invalid":
      return "Invalid";
    default:
      return status.state;
  }
}

function shortHash(value?: string | null) {
  if (!value) {
    return "Unavailable";
  }
  if (value.length <= 28) {
    return value;
  }
  return `${value.slice(0, 18)}...${value.slice(-8)}`;
}

function messageFor(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function progressPercent(progress: KeyBundleProgress | null) {
  if (!progress || progress.total_bytes <= 0) {
    return null;
  }
  return Math.min(100, Math.floor((progress.copied_bytes / progress.total_bytes) * 100));
}
