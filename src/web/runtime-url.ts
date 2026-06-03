const BRIDGE_PORT_KEY = "sf:bridge-port";
const BRIDGE_TOKEN_KEY = "sf:bridge-token";
const WORKER_WATCH_URL_KEY = "sf:worker-watch-url";
const DEFAULT_MOBILE_VIEWER_URL = "https://sync-and-flow.pages.dev/";

export function resolveWorkerUrl(): string {
  return resolveOptionalWorkerUrl() ?? "ws://localhost:8787";
}

export function resolveOptionalWorkerUrl(): string | null {
  const fromQuery = new URLSearchParams(location.search).get("worker");
  if (fromQuery) return fromQuery;

  const fromEnv = import.meta.env.VITE_SYNC_FLOW_WORKER_URL as string | undefined;
  if (fromEnv) return fromEnv;

  const fromBridge = sessionStorage.getItem(WORKER_WATCH_URL_KEY);
  if (fromBridge) return fromBridge;

  return null;
}

export function setRuntimeWorkerWatchUrl(workerWatchUrl: string | null | undefined): void {
  if (!workerWatchUrl) return;
  sessionStorage.setItem(WORKER_WATCH_URL_KEY, workerWatchUrl);
}

export function resolveOptionalWorkerWatchUrl(): string | null {
  const workerUrl = resolveOptionalWorkerUrl();
  return workerUrl ? stripWorkerPublishToken(workerUrl) : null;
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
  if (isBridgePaused()) return false;
  return Boolean(params.get("bridgeToken") ?? sessionStorage.getItem(BRIDGE_TOKEN_KEY));
}

export function isBridgePaused(): boolean {
  return new URLSearchParams(location.search).get("bridgePaused") === "1";
}

export async function buildViewerUrl(): Promise<string | null> {
  const fromQuery = new URLSearchParams(location.search).get("viewer");
  if (fromQuery) return withWorkerWatchUrl(fromQuery);

  const fromEnv = import.meta.env.VITE_SYNC_FLOW_VIEWER_URL as string | undefined;
  if (fromEnv) return withWorkerWatchUrl(fromEnv);

  return withWorkerWatchUrl(DEFAULT_MOBILE_VIEWER_URL);
}

export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

function stripWorkerPublishToken(workerUrl: string): string {
  try {
    const url = new URL(workerUrl);
    url.searchParams.delete("token");
    return url.toString();
  } catch {
    return workerUrl;
  }
}

function withWorkerWatchUrl(viewerUrl: string): string {
  const workerUrl = resolveOptionalWorkerWatchUrl();
  if (!workerUrl) return viewerUrl;
  try {
    const url = new URL(viewerUrl);
    url.searchParams.set("worker", workerUrl);
    return url.toString();
  } catch {
    return viewerUrl;
  }
}
