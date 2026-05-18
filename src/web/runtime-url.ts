const LAN_HOST_KEY = "sf:lan-host";
const BRIDGE_PORT_KEY = "sf:bridge-port";
const BRIDGE_TOKEN_KEY = "sf:bridge-token";

export function resolveWorkerUrl(): string {
  const fromQuery = new URLSearchParams(location.search).get("worker");
  if (fromQuery) return fromQuery;

  const fromEnv = import.meta.env.VITE_SYNC_FLOW_WORKER_URL as string | undefined;
  if (fromEnv) return fromEnv;

  if (location.protocol === "https:") {
    return `${location.origin.replace(/^https:/, "wss:")}/presence`;
  }

  if (!isLocalHost(location.hostname)) {
    return `ws://${location.hostname}:8787`;
  }

  return "ws://localhost:8787";
}

export function resolveBridgeUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const params = new URLSearchParams(location.search);
  if (params.get("bridgePaused") === "1") {
    sessionStorage.removeItem(BRIDGE_PORT_KEY);
    sessionStorage.removeItem(BRIDGE_TOKEN_KEY);
  }
  const port = params.get("bridgePort") ?? sessionStorage.getItem(BRIDGE_PORT_KEY);
  const token = params.get("bridgeToken") ?? sessionStorage.getItem(BRIDGE_TOKEN_KEY);

  if (port) sessionStorage.setItem(BRIDGE_PORT_KEY, port);
  if (token) sessionStorage.setItem(BRIDGE_TOKEN_KEY, token);

  const bridgeUrl = new URL(`http://127.0.0.1:${port ?? "3001"}${normalizedPath}`);
  if (token) bridgeUrl.searchParams.set("token", token);
  return bridgeUrl.toString();
}

export function hasBridgeCredentials(): boolean {
  const params = new URLSearchParams(location.search);
  return Boolean(params.get("bridgeToken") ?? sessionStorage.getItem(BRIDGE_TOKEN_KEY));
}

export async function buildViewerUrl(): Promise<string | null> {
  const fromEnv = import.meta.env.VITE_SYNC_FLOW_VIEWER_URL as string | undefined;
  if (fromEnv) return fromEnv;

  if (isTauriRuntime()) return buildLanViewerUrl();

  const page = new URL(location.href);

  if (location.protocol === "https:" && !isLocalHost(location.hostname)) {
    page.searchParams.delete("worker");
    return page.toString();
  }

  return buildLanViewerUrl(location.hostname);
}

export function getStoredLanHost(): string {
  return localStorage.getItem(LAN_HOST_KEY) ?? "";
}

export function buildLanViewerUrlFromHost(host: string): string {
  const normalizedHost = host.trim();
  if (!normalizedHost) throw new Error("Enter your Mac LAN IP.");

  localStorage.setItem(LAN_HOST_KEY, normalizedHost);
  const page = new URL(`http://${normalizedHost}:5173/`);
  page.searchParams.set("worker", `ws://${normalizedHost}:8787`);
  return page.toString();
}

async function buildLanViewerUrl(currentHost = ""): Promise<string | null> {
  const stored = localStorage.getItem(LAN_HOST_KEY);
  const defaultHost = currentHost && !isLocalHost(currentHost) ? currentHost : stored ?? "";
  const host = window.prompt("Enter your Mac LAN IP for mobile access", defaultHost);
  if (!host) return null;

  return buildLanViewerUrlFromHost(host);
}

export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}
