// Same-origin relay for desktop-helper pairing.
//
// The desktop app can only ask the OS to open a URL, which always spawns a NEW
// browser tab carrying the `#helper=…&pair=…` fragment. That courier tab cannot
// inject into the tab where the user is mid-flow. This relay lets the courier
// hand the pairing to an existing same-origin tab over a BroadcastChannel (with
// a localStorage `storage`-event fallback), so the original tab pairs in place
// with all its in-memory progress intact. If no existing tab acknowledges, the
// courier falls back to pairing itself.

export type HelperPairing = {
  helperUrl: string;
  token: string;
};

const CHANNEL_NAME = "proof-tool.helper-pairing.v1";
const STORAGE_KEY = "proof-tool.helper-pairing.relay.v1";

type PairMessage = {
  kind: "pair";
  id: string;
  sender: string;
  helperUrl: string;
  token: string;
};

type AckMessage = {
  kind: "pair-ack";
  id: string;
  sender: string;
  target: string;
};

type RelayMessage = PairMessage | AckMessage;

export type PairingSubscription = {
  sender: string;
  onPair?: (pairing: HelperPairing & { sender: string }) => void;
  onAck?: (target: string) => void;
};

// Stable per-tab id used to ignore our own broadcasts and to address ACKs.
export function createRelayId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the non-cryptographic id below.
  }
  return `relay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function broadcastPairing(pairing: HelperPairing, sender: string): void {
  post({
    kind: "pair",
    id: createRelayId(),
    sender,
    helperUrl: pairing.helperUrl,
    token: pairing.token,
  });
}

export function acknowledgePairing(target: string, sender: string): void {
  post({ kind: "pair-ack", id: createRelayId(), sender, target });
}

export function subscribeToPairing(options: PairingSubscription): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const seen = new Set<string>();
  const handle = (raw: unknown) => {
    const message = parseMessage(raw);
    if (!message || message.sender === options.sender || seen.has(message.id)) {
      return;
    }
    seen.add(message.id);
    if (message.kind === "pair") {
      options.onPair?.({ helperUrl: message.helperUrl, token: message.token, sender: message.sender });
    } else {
      options.onAck?.(message.target);
    }
  };

  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => handle(event.data);
    }
  } catch {
    channel = null;
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) {
      return;
    }
    try {
      handle(JSON.parse(event.newValue));
    } catch {
      // Ignore malformed relay payloads.
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    if (channel) {
      channel.onmessage = null;
      channel.close();
    }
    window.removeEventListener("storage", onStorage);
  };
}

function post(message: RelayMessage): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(message);
      channel.close();
    }
  } catch {
    // BroadcastChannel unavailable; the storage fallback below still delivers.
  }
  try {
    // Writing then clearing fires a `storage` event in other same-origin tabs
    // without persisting the pairing token to disk.
    const serialized = JSON.stringify(message);
    window.localStorage.setItem(STORAGE_KEY, serialized);
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage may be unavailable (private mode); BroadcastChannel covers it.
  }
}

function parseMessage(raw: unknown): RelayMessage | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.sender !== "string") {
    return null;
  }
  if (value.kind === "pair") {
    if (typeof value.helperUrl !== "string" || typeof value.token !== "string") {
      return null;
    }
    return { kind: "pair", id: value.id, sender: value.sender, helperUrl: value.helperUrl, token: value.token };
  }
  if (value.kind === "pair-ack") {
    if (typeof value.target !== "string") {
      return null;
    }
    return { kind: "pair-ack", id: value.id, sender: value.sender, target: value.target };
  }
  return null;
}
