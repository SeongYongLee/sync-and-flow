import { chromium } from "playwright-core";

const requestedUrl = process.argv[2] ?? "http://127.0.0.1:5175/?worker=ws://127.0.0.1:8787";
const pageUrl = new URL(requestedUrl);
if (process.env.DEMO_PLANETS === "1") pageUrl.searchParams.set("bridgePaused", "1");
const url = pageUrl.toString();
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI__", { value: {}, configurable: true });
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.waitForSelector("#canvas", { timeout: 5_000 });
  await page.waitForTimeout(1_000);

  if (process.env.DEMO_PLANETS === "1") {
    const workerUrl = new URL(url).searchParams.get("worker") ?? "ws://127.0.0.1:8787";
    const publishUrl = toHttpPublishUrl(workerUrl);
    const res = await fetch(publishUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "publish",
        userId: "smoke-demo",
        nickname: "Smoke Demo",
        color: "#80b4ff",
        source: "codex",
        provider: "openai",
        model: "gpt-5-codex",
        delta: { inputTokens: 10, outputTokens: 90, cacheReadTokens: 0 },
        totals: { inputTokens: 10, outputTokens: 90, cacheReadTokens: 0, turns: 1, totalUsd: 0 },
        energy: 90,
        timestamp: new Date().toISOString(),
      }),
    });
    if (!res.ok) throw new Error(`demo publish failed: HTTP ${res.status}`);
    await page.waitForFunction(() => document.querySelector("#planet")?.textContent?.includes("Forge"), null, { timeout: 8_000 });
  }

  const canvasStats = await page.locator("#canvas").evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#canvas is not a canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");

    const { width, height } = canvas;
    const sample = ctx.getImageData(0, 0, Math.min(width, 320), Math.min(height, 240)).data;
    let nonBackground = 0;
    for (let i = 0; i < sample.length; i += 4) {
      const r = sample[i];
      const g = sample[i + 1];
      const b = sample[i + 2];
      const a = sample[i + 3];
      if (a !== 255 || r !== 8 || g !== 6 || b !== 20) nonBackground++;
    }
    return { width, height, nonBackground };
  });

  if (canvasStats.width < 1000 || canvasStats.height < 700) {
    throw new Error(`unexpected canvas size: ${canvasStats.width}x${canvasStats.height}`);
  }
  if (canvasStats.nonBackground < 100) {
    throw new Error(`canvas appears blank: ${JSON.stringify(canvasStats)}`);
  }

  const diagnosticsAvailable = await page.locator("#diagnostics-toggle").evaluate((button) => !button.hidden);
  if (diagnosticsAvailable) {
    await page.locator("#diagnostics-toggle").click();
    await page.waitForSelector("#diagnostics-panel:not([hidden])", { timeout: 5_000 });
    await page.waitForSelector("#diagnostics-grid dd", { timeout: 5_000 });

    const diagnosticsVisible = await page.locator("#diagnostics-panel").evaluate((panel) => !panel.hasAttribute("hidden"));
    const diagnosticsText = await page.locator("#diagnostics-grid").innerText();
    if (!diagnosticsVisible || diagnosticsText.trim().length === 0) {
      throw new Error(`diagnostics panel did not open: ${diagnosticsText}`);
    }
  }

  const status = await page.locator("#status").innerText();
  const model = await page.locator("#model").innerText();
  const planet = await page.locator("#planet").innerText();
  const mix = await page.locator("#planet-mix").innerText();
  if (process.env.REQUIRE_WORKER === "1" && !status.includes("MULTI LIVE")) {
    throw new Error(`expected Worker presence to be live, got: ${status}`);
  }
  if (!planet.trim() || !mix.trim()) {
    throw new Error(`planet HUD did not render: planet=${planet}, mix=${mix}`);
  }
  if (process.env.DEMO_PLANETS === "1" && !planet.includes("Forge")) {
    throw new Error(`expected demo planet Forge, got: ${planet}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobileHudOk = await page.locator("#hud").evaluate((hud) => {
    const rect = hud.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0;
  });
  if (!mobileHudOk) throw new Error("mobile HUD is outside the viewport");

  console.log(`[smoke] page OK: ${url}`);
  console.log(`[smoke] status: ${status}`);
  console.log(`[smoke] model: ${model}`);
  console.log(`[smoke] planet: ${planet}`);
  console.log(`[smoke] mix: ${mix}`);
  console.log(`[smoke] canvas: ${canvasStats.width}x${canvasStats.height}, nonBackground=${canvasStats.nonBackground}`);
  console.log(`[smoke] diagnostics: ${diagnosticsAvailable ? "checked" : "hidden"}`);

  if (errors.length > 0) {
    console.warn(`[smoke] console errors observed:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }
} finally {
  await browser.close();
}

function toHttpPublishUrl(url) {
  const parsed = new URL(url.trim());
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  if (parsed.protocol === "wss:") parsed.protocol = "https:";
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/publish`;
    return parsed.toString();
  }
  throw new Error(`Unsupported worker URL: ${url}`);
}
