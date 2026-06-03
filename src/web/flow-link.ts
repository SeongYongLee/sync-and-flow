import { resolveBridgeUrl, resolveOptionalWorkerWatchUrl } from "./runtime-url.js";

export function setupFlowLinkPrompt(mode: "local-bridge" | "browser-only") {
  const card = document.getElementById("flow-link-card")!;
  const modal = document.getElementById("flow-link-modal")!;
  const install = document.getElementById("flow-link-install") as HTMLButtonElement | null;
  const dismiss = document.getElementById("flow-link-dismiss") as HTMLButtonElement | null;
  const close = document.getElementById("flow-link-close") as HTMLButtonElement | null;
  const worker = document.getElementById("flow-link-worker-url")!;
  const macDownload = document.getElementById("flow-link-download-mac") as HTMLAnchorElement | null;
  const windowsDownload = document.getElementById("flow-link-download-windows") as HTMLAnchorElement | null;

  if (mode === "local-bridge") {
    card.setAttribute("hidden", "");
    return;
  }

  card.removeAttribute("hidden");
  worker.textContent = resolveOptionalWorkerWatchUrl() ?? resolveBridgeUrl("/events");
  setupDownloadLink(macDownload, "mac", { fallback: "/downloads/Flow-Link.dmg" });
  setupDownloadLink(windowsDownload, "windows", { fallback: null });
  markRecommendedDownload(detectPlatform());

  install?.addEventListener("click", () => modal.removeAttribute("hidden"));
  dismiss?.addEventListener("click", () => card.setAttribute("hidden", ""));
  close?.addEventListener("click", () => modal.setAttribute("hidden", ""));
}

type FlowLinkPlatform = "mac" | "windows" | "unknown";

function setupDownloadLink(
  link: HTMLAnchorElement | null,
  platform: Exclude<FlowLinkPlatform, "unknown">,
  options: { fallback: string | null },
) {
  if (!link) return;
  const envKey = platform === "mac" ? "VITE_FLOW_LINK_MAC_DOWNLOAD_URL" : "VITE_FLOW_LINK_WINDOWS_DOWNLOAD_URL";
  const href = (import.meta.env[envKey] as string | undefined) ?? options.fallback;
  if (!href) {
    link.hidden = true;
    return;
  }
  link.hidden = false;
  link.href = href;
}

function markRecommendedDownload(platform: FlowLinkPlatform) {
  const macDownload = document.getElementById("flow-link-download-mac");
  const windowsDownload = document.getElementById("flow-link-download-windows");
  macDownload?.removeAttribute("data-recommended");
  windowsDownload?.removeAttribute("data-recommended");

  if (platform === "mac") macDownload?.setAttribute("data-recommended", "true");
  if (platform === "windows") windowsDownload?.setAttribute("data-recommended", "true");
}

function detectPlatform(): FlowLinkPlatform {
  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = `${userAgentData?.platform ?? navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (platform.includes("mac")) return "mac";
  if (platform.includes("win")) return "windows";
  return "unknown";
}
