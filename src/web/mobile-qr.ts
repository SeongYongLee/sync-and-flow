import { toString as qrToString } from "qrcode";
import { buildLanViewerUrlFromHost, buildViewerUrl, getStoredLanHost, isTauriRuntime } from "./runtime-url.js";

export function setupMobileQr() {
  const button = document.getElementById("mobile-share") as HTMLButtonElement | null;
  const panel = document.getElementById("mobile-qr-panel")!;
  const qr = document.getElementById("mobile-qr")!;
  const urlText = document.getElementById("mobile-url")!;
  const hostForm = document.getElementById("mobile-host-form") as HTMLFormElement | null;
  const hostInput = document.getElementById("mobile-host") as HTMLInputElement | null;
  const close = document.getElementById("mobile-qr-close") as HTMLButtonElement | null;

  button?.addEventListener("click", async () => {
    panel.removeAttribute("hidden");
    hostForm?.setAttribute("hidden", "");
    qr.removeAttribute("hidden");
    qr.textContent = "Preparing QR...";
    urlText.textContent = "";

    try {
      const url = await buildMobileUrl(hostForm, hostInput, qr, urlText);
      if (!url) return;
      await renderQr(url, qr, urlText);
    } catch (error) {
      qr.textContent = "QR unavailable";
      urlText.textContent = error instanceof Error ? error.message : "Could not create mobile URL.";
    }
  });

  hostForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const url = buildLanViewerUrlFromHost(hostInput?.value ?? "");
      qr.removeAttribute("hidden");
      await renderQr(url, qr, urlText);
      hostForm.setAttribute("hidden", "");
    } catch (error) {
      qr.removeAttribute("hidden");
      qr.textContent = "QR unavailable";
      urlText.textContent = error instanceof Error ? error.message : "Could not create mobile URL.";
    }
  });

  close?.addEventListener("click", () => panel.setAttribute("hidden", ""));
}

async function buildMobileUrl(
  hostForm: HTMLFormElement | null,
  hostInput: HTMLInputElement | null,
  qr: HTMLElement,
  urlText: HTMLElement,
): Promise<string | null> {
  if (isTauriRuntime()) {
    const storedHost = getStoredLanHost();
    if (!storedHost) {
      hostForm?.removeAttribute("hidden");
      qr.setAttribute("hidden", "");
      qr.textContent = "";
      urlText.textContent = "";
      if (hostInput) {
        hostInput.value = "";
        hostInput.focus();
      }
      return null;
    }
    return buildLanViewerUrlFromHost(storedHost);
  }

  hostForm?.setAttribute("hidden", "");
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
