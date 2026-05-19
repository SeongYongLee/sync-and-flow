import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://127.0.0.1:5175/?worker=ws://127.0.0.1:8787&bridgePaused=1";
const publishUrl = process.argv[3] ?? "http://127.0.0.1:8787/publish";
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const identity = { userId: "sync-smoke", nickname: "Sync Smoke", color: "#80b4ff" };

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check"],
});

try {
  const pages = await Promise.all([newViewer(), newViewer()]);
  await Promise.all(pages.map((page) => page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 })));
  await Promise.all(pages.map((page) => page.waitForSelector("#canvas", { timeout: 5_000 })));
  await Promise.all(pages.map((page) => page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("MULTI LIVE"), null, { timeout: 8_000 })));

  const body = {
    kind: "publish",
    ...identity,
    source: "codex",
    provider: "openai",
    model: "gpt-5-codex",
    delta: { inputTokens: 10, outputTokens: 96, cacheReadTokens: 0 },
    totals: { inputTokens: 10, outputTokens: 96, cacheReadTokens: 0, turns: 1, totalUsd: 0 },
    energy: 96,
    timestamp: new Date().toISOString(),
  };

  const res = await fetch(publishUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`publish failed: HTTP ${res.status} ${await res.text()}`);

  await Promise.all(pages.map((page) => page.waitForFunction(() => document.querySelector("#planet")?.textContent?.includes("Forge"), null, { timeout: 8_000 })));
  const states = await Promise.all(pages.map(async (page) => ({
    model: await page.locator("#model").innerText(),
    planet: await page.locator("#planet").innerText(),
    mix: await page.locator("#planet-mix").innerText(),
    viewers: await page.locator("#viewers").innerText(),
  })));

  if (JSON.stringify(states[0]) !== JSON.stringify(states[1])) {
    throw new Error(`viewer states diverged: ${JSON.stringify(states)}`);
  }

  console.log(`[sync-smoke] both viewers matched: ${JSON.stringify(states[0])}`);
} finally {
  await browser.close();
}

async function newViewer() {
  const page = await browser.newPage({ viewport: { width: 960, height: 680 }, deviceScaleFactor: 1 });
  await page.addInitScript((storedIdentity) => {
    localStorage.setItem("sf:viewer-identity", JSON.stringify(storedIdentity));
  }, identity);
  return page;
}
