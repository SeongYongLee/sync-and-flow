import { hasBridgeCredentials, isTauriRuntime, resolveBridgeUrl } from "./runtime-url.js";

type HealthValue = string | number | boolean | string[] | Record<string, unknown> | null;
type HealthPayload = Record<string, HealthValue>;

const SUMMARY_FIELDS = [
  "ok",
  "runtime",
  "buildId",
  "sourceRoots",
  "sources",
  "watchedFiles",
  "readLines",
  "parseMisses",
  "lastEventAt",
  "lastSource",
  "lastModel",
  "workerUrl",
  "lastWorkerPublishAt",
  "lastWorkerError",
] as const;

const DETAIL_FIELDS = [
  "scanRoots",
  "clients",
  "watchedBytes",
  "latestFile",
  "latestFileSize",
  "latestFileModifiedAt",
  "recentJsonlFiles",
  "lastScanAt",
  "lastFile",
  "lastReadAt",
  "lastReadFile",
  "lastError",
] as const;

export function setupDiagnostics() {
  const toggle = document.getElementById("diagnostics-toggle") as HTMLButtonElement | null;
  const panel = document.getElementById("diagnostics-panel") as HTMLElement | null;
  const close = document.getElementById("diagnostics-close") as HTMLButtonElement | null;
  const refresh = document.getElementById("diagnostics-refresh") as HTMLButtonElement | null;
  const grid = document.getElementById("diagnostics-grid") as HTMLDListElement | null;
  const detailGrid = document.getElementById("diagnostics-detail-grid") as HTMLDListElement | null;
  if (!toggle || !panel || !close || !refresh || !grid || !detailGrid) return;

  const showDebugButton = isTauriRuntime() && hasBridgeCredentials();
  toggle.hidden = !showDebugButton;

  const open = async () => {
    panel.hidden = false;
    await renderHealth(grid, detailGrid);
  };
  const hide = () => {
    panel.hidden = true;
    if (location.hash === "#diagnostics") history.replaceState(null, "", location.pathname + location.search);
  };

  toggle.addEventListener("click", () => void open());
  refresh.addEventListener("click", () => void renderHealth(grid, detailGrid));
  close.addEventListener("click", hide);
  window.addEventListener("hashchange", () => {
    if (location.hash === "#diagnostics") void open();
  });

  if (location.hash === "#diagnostics") void open();
}

async function renderHealth(grid: HTMLDListElement, detailGrid: HTMLDListElement) {
  grid.innerHTML = `<dt>Status</dt><dd>Loading...</dd>`;
  detailGrid.innerHTML = "";
  try {
    const res = await fetch(resolveBridgeUrl("/health"));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as HealthPayload;
    grid.innerHTML = SUMMARY_FIELDS.map((field) => row(field, formatHealthValue(field, payload[field]))).join("");
    detailGrid.innerHTML = DETAIL_FIELDS.map((field) => row(field, formatHealthValue(field, payload[field]))).join("");
  } catch (error) {
    grid.innerHTML = row("error", error instanceof Error ? error.message : String(error));
    detailGrid.innerHTML = "";
  }
}

function row(label: string, value: string): string {
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

function formatHealthValue(field: string, value: HealthValue | undefined): string {
  if (value === undefined || value === null || value === "") return "-";
  if (field === "sourceRoots" && typeof value === "object" && !Array.isArray(value)) return formatSourceRoots(value);
  if (field === "recentJsonlFiles" && Array.isArray(value)) return formatRecentJsonlFiles(value);
  if (Array.isArray(value)) return value.length ? value.join(", ") : "-";
  if (typeof value === "object") return JSON.stringify(value);
  if (
    (field === "lastScanAt" ||
      field === "lastEventAt" ||
      field === "lastReadAt" ||
      field === "latestFileModifiedAt" ||
      field === "lastWorkerPublishAt") &&
    typeof value === "string"
  ) {
    const date = new Date(Number(value));
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
  }
  return field.toLowerCase().includes("file") ? shortenPath(String(value)) : String(value);
}

function formatSourceRoots(value: Record<string, unknown>): string {
  const parts = ["claude", "codex", "pi"].map((source) => {
    const status = value[source];
    if (!isRecord(status)) return `${source}: -`;
    const root = status["root"] === "exists" ? "root ok" : "root missing";
    const logDir = status["logDir"] === "exists" ? "log ok" : "log missing";
    return `${source}: ${root}, ${logDir}, supported ${status["supportedFiles"] ?? 0}, recent ${status["recentFiles"] ?? 0}`;
  });
  return parts.join(" / ");
}

function formatRecentJsonlFiles(value: string[]): string {
  if (!value.length) return "-";
  return value.slice(0, 3).map(formatRecentJsonlFile).join(" / ");
}

function formatRecentJsonlFile(value: string): string {
  const parts = value.split(" | ");
  if (parts.length < 4) return shortenPath(value);
  const [, size, support, path] = parts;
  if (!size || !support || !path) return shortenPath(value);
  return `${support} ${size} ${shortenPath(path)}`;
}

function shortenPath(value: string): string {
  if (value.length <= 58) return value;
  const normalized = value.replace(/^\/Users\/[^/]+/, "~");
  if (normalized.length <= 58) return normalized;
  const segments = normalized.split("/");
  const file = segments.at(-1) ?? normalized;
  const parent = segments.at(-2);
  const tail = parent ? `${parent}/${file}` : file;
  return tail.length <= 54 ? `.../${tail}` : `.../${tail.slice(0, 24)}...${tail.slice(-24)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
