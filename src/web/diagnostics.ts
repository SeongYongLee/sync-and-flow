import { hasBridgeCredentials, isTauriRuntime, resolveBridgeUrl } from "./runtime-url.js";
import { clearProgress, formatProgressSummary, loadProgress } from "./progress.js";

type HealthValue = string | number | boolean | string[] | Record<string, unknown> | null;
type HealthPayload = Record<string, HealthValue>;

const SUMMARY_FIELDS = [
  "ok",
  "runtime",
  "sources",
  "watchedFiles",
  "lastEventAt",
  "lastSource",
  "lastModel",
] as const;

const DETAIL_FIELDS = [
  "appVersion",
  "buildId",
  "sourceRoots",
  "scanRoots",
  "clients",
  "readLines",
  "parseMisses",
  "watchedBytes",
  "latestFile",
  "latestFileSize",
  "latestFileModifiedAt",
  "recentJsonlFiles",
  "lastScanAt",
  "lastFile",
  "lastReadAt",
  "lastReadFile",
  "workerUrl",
  "lastWorkerPublishAt",
  "lastWorkerError",
  "lastError",
] as const;

const FIELD_LABELS: Record<string, string> = {
  ok: "Status",
  runtime: "Runtime",
  sources: "Active sources",
  watchedFiles: "Watched files",
  lastEventAt: "Last event",
  lastSource: "Last source",
  lastModel: "Last model",
  appVersion: "App version",
  buildId: "Build",
  sourceRoots: "Source roots",
  scanRoots: "Scan roots",
  clients: "Clients",
  readLines: "Read lines",
  parseMisses: "Parse misses",
  watchedBytes: "Watched bytes",
  latestFile: "Latest file",
  latestFileSize: "Latest size",
  latestFileModifiedAt: "Latest modified",
  recentJsonlFiles: "Recent logs",
  lastScanAt: "Last scan",
  lastFile: "Last file",
  lastReadAt: "Last read",
  lastReadFile: "Last read file",
  workerUrl: "Worker URL",
  lastWorkerPublishAt: "Last worker publish",
  lastWorkerError: "Last worker error",
  lastError: "Last error",
};

export function setupDiagnostics(userId: string) {
  const toggle = document.getElementById("diagnostics-toggle") as HTMLButtonElement | null;
  const panel = document.getElementById("diagnostics-panel") as HTMLElement | null;
  const close = document.getElementById("diagnostics-close") as HTMLButtonElement | null;
  const refresh = document.getElementById("diagnostics-refresh") as HTMLButtonElement | null;
  const resetProgress = document.getElementById("diagnostics-reset-progress") as HTMLButtonElement | null;
  const grid = document.getElementById("diagnostics-grid") as HTMLDListElement | null;
  const progressGrid = document.getElementById("diagnostics-progress-grid") as HTMLDListElement | null;
  const progressCards = document.getElementById("diagnostics-progress-cards") as HTMLElement | null;
  const detailGrid = document.getElementById("diagnostics-detail-grid") as HTMLDListElement | null;
  if (!toggle || !panel || !close || !refresh || !resetProgress || !grid || !progressGrid || !progressCards || !detailGrid) return;

  const showBridgeDiagnostics = isTauriRuntime() && hasBridgeCredentials();
  toggle.hidden = false;

  const open = async () => {
    panel.hidden = false;
    renderProgress(userId, progressCards, progressGrid);
    await renderHealth(grid, detailGrid, showBridgeDiagnostics);
  };
  const hide = () => {
    panel.hidden = true;
    if (location.hash === "#diagnostics") history.replaceState(null, "", location.pathname + location.search);
  };

  toggle.addEventListener("click", () => void open());
  refresh.addEventListener("click", () => {
    renderProgress(userId, progressCards, progressGrid);
    void renderHealth(grid, detailGrid, showBridgeDiagnostics);
  });
  resetProgress.addEventListener("click", () => {
    clearProgress(userId);
    renderProgress(userId, progressCards, progressGrid);
  });
  close.addEventListener("click", hide);
  window.addEventListener("hashchange", () => {
    if (location.hash === "#diagnostics") void open();
  });

  if (location.hash === "#diagnostics") void open();
}

function renderProgress(userId: string, progressCards: HTMLElement, progressGrid: HTMLDListElement) {
  const summary = formatProgressSummary(loadProgress(userId));
  progressCards.innerHTML = [
    metricCard("Turns", summary.turns),
    metricCard("Output", summary.outputTokens),
    metricCard("Energy", summary.energy),
    metricCard("Planet", titleCase(summary.planet)),
  ].join("");
  progressGrid.innerHTML = [
    row("Saved", summary.saved),
    row("Last saved", summary.updatedAt),
    row("Model", summary.model),
  ].join("");
}

async function renderHealth(grid: HTMLDListElement, detailGrid: HTMLDListElement, enabled: boolean) {
  if (!enabled) {
    grid.innerHTML = row("Bridge", "Local-only mode");
    detailGrid.innerHTML = "";
    return;
  }

  grid.innerHTML = `<dt>Status</dt><dd>Loading...</dd>`;
  detailGrid.innerHTML = "";
  try {
    const res = await fetch(resolveBridgeUrl("/health"));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as HealthPayload;
    grid.innerHTML = SUMMARY_FIELDS.map((field) => row(labelFor(field), formatHealthValue(field, payload[field]))).join("");
    detailGrid.innerHTML = DETAIL_FIELDS.map((field) => row(labelFor(field), formatHealthValue(field, payload[field]))).join("");
  } catch (error) {
    grid.innerHTML = row("error", error instanceof Error ? error.message : String(error));
    detailGrid.innerHTML = "";
  }
}

function row(label: string, value: string): string {
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

function metricCard(label: string, value: string): string {
  return `<div class="diagnostics-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function labelFor(field: string): string {
  return FIELD_LABELS[field] ?? field;
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

function titleCase(value: string): string {
  if (!value || value === "-") return value;
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
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
