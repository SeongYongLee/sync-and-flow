import { colorForId, createIdentity, type Identity } from "../shared/nickname.js";
import { isBridgePaused, resolveBridgeUrl } from "./runtime-url.js";

const VIEWER_KEY = "sf:viewer-identity";

export interface PresenceIdentityResult {
  identity: Identity;
  mode: "local-bridge" | "browser-only";
}

export function getBrowserIdentity(): Identity {
  const stored = readStorage(localStorage, VIEWER_KEY) ?? readStorage(sessionStorage, VIEWER_KEY);
  if (stored) return stored;

  const identity = createIdentity(safeRandomUUID);
  writeStorage(localStorage, VIEWER_KEY, identity) || writeStorage(sessionStorage, VIEWER_KEY, identity);
  return identity;
}

export async function getPresenceIdentity(): Promise<Identity> {
  return (await getPresenceIdentityResult()).identity;
}

export async function getPresenceIdentityResult(): Promise<PresenceIdentityResult> {
  const bridgeIdentity = await fetchBridgeIdentity();
  if (bridgeIdentity) {
    return { identity: bridgeIdentity, mode: "local-bridge" };
  }

  return { identity: getBrowserIdentity(), mode: "browser-only" };
}

async function fetchBridgeIdentity(): Promise<Identity | null> {
  if (isBridgePaused()) return null;
  const urls = [resolveBridgeUrl("/identity")];

  for (const url of urls) {
    const identity = await fetchIdentityUrl(url);
    if (identity) return identity;
  }

  return null;
}

async function fetchIdentityUrl(url: string): Promise<Identity | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 800);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const identity = (await res.json()) as Identity;
    return identity.userId && identity.nickname ? identity : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function readStorage(storage: Storage, key: string): Identity | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Identity>;
    if (!parsed.userId || !parsed.nickname) return null;
    return { userId: parsed.userId, nickname: parsed.nickname, color: parsed.color ?? colorForId(parsed.userId) };
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage, key: string, identity: Identity): boolean {
  try {
    storage.setItem(key, JSON.stringify(identity));
    return true;
  } catch {
    return false;
  }
}

function safeRandomUUID(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
