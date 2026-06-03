import { toString as qrToString } from "qrcode";
import { buildViewerUrl, resolveOptionalWorkerWatchUrl } from "./runtime-url.js";

const ACTIVE_LABEL = "MOBILE QR";
const INACTIVE_LABEL = "MOBILE OFF";

export function setupMobileQr() {
  const button = document.getElementById("mobile-share") as HTMLButtonElement | null;
  const panel = document.getElementById("mobile-qr-panel")!;
  const qr = document.getElementById("mobile-qr")!;
  const urlText = document.getElementById("mobile-url")!;
  const close = document.getElementById("mobile-qr-close") as HTMLButtonElement | null;
  updateMobileQrAvailability();

  button?.addEventListener("click", async () => {
    updateMobileQrAvailability();
    panel.removeAttribute("hidden");
    qr.removeAttribute("hidden");
    qr.textContent = "Preparing QR...";
    urlText.textContent = "";

    try {
      const url = await buildMobileUrl(qr, urlText);
      if (!url) return;
      await renderQr(url, qr, urlText);
    } catch (error) {
      qr.textContent = "QR unavailable";
      urlText.textContent = error instanceof Error ? error.message : "Could not create mobile URL.";
    }
  });

  close?.addEventListener("click", () => panel.setAttribute("hidden", ""));
}

export function updateMobileQrAvailability(): void {
  const button = document.getElementById("mobile-share") as HTMLButtonElement | null;
  if (!button) return;
  const enabled = Boolean(resolveOptionalWorkerWatchUrl());
  button.textContent = enabled ? ACTIVE_LABEL : INACTIVE_LABEL;
  button.title = enabled ? "Open this flow on a phone." : "Mobile QR needs remote presence.";
}

async function buildMobileUrl(qr: HTMLElement, urlText: HTMLElement): Promise<string | null> {
  if (!resolveOptionalWorkerWatchUrl()) {
    qr.setAttribute("hidden", "");
    qr.textContent = "";
    urlText.textContent = "Mobile viewing needs remote presence. Start with a Worker URL to generate a mobile QR.";
    return null;
  }

  return buildViewerUrl();
}

async function renderQr(url: string, qr: HTMLElement, urlText: HTMLElement): Promise<void> {
  urlText.textContent = url;
  qr.innerHTML = await qrToString(url, {
    type: "svg",
    margin: 1,
    width: 220,
    color: {
      dark: "#0f172a",
      light: "#f8fafc",
    },
  });
}
