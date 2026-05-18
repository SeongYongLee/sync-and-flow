import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://127.0.0.1:5175/?worker=ws://127.0.0.1:8787";
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
  if (process.env.REQUIRE_WORKER === "1" && !status.includes("MULTI LIVE")) {
    throw new Error(`expected Worker presence to be live, got: ${status}`);
  }
  console.log(`[smoke] page OK: ${url}`);
  console.log(`[smoke] status: ${status}`);
  console.log(`[smoke] model: ${model}`);
  console.log(`[smoke] canvas: ${canvasStats.width}x${canvasStats.height}, nonBackground=${canvasStats.nonBackground}`);
  console.log(`[smoke] diagnostics: ${diagnosticsAvailable ? "checked" : "hidden"}`);

  if (errors.length > 0) {
    console.warn(`[smoke] console errors observed:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }
} finally {
  await browser.close();
}
