const baseUrl =
  process.argv[2] ??
  process.env.SYNC_FLOW_WORKER_URL ??
  process.env.VITE_SYNC_FLOW_WORKER_URL ??
  "ws://localhost:8787";

const watchUrl = `${baseUrl.replace(/\/$/, "")}/watch`;
const publishUrl = toHttpPublishUrl(baseUrl);
const identity = {
  userId: `e2e-${Date.now()}`,
  nickname: "e2e-flow-link",
  color: "#80b4ff",
};

const payload = {
  kind: "publish",
  ...identity,
  source: "codex",
  provider: "openai",
  model: "e2e-model",
  delta: {
    outputTokens: 42,
    inputTokens: 12,
    cacheReadTokens: 3,
  },
  totals: {
    outputTokens: 42,
    inputTokens: 12,
    cacheReadTokens: 3,
    turns: 1,
    totalUsd: 0,
  },
  energy: 45,
  timestamp: new Date().toISOString(),
};

console.log(`[e2e] watch: ${watchUrl}`);
console.log(`[e2e] publish: ${publishUrl}`);

const ws = new WebSocket(watchUrl);
let finished = false;

const timeout = setTimeout(() => {
  fail("timed out waiting for worker turn broadcast");
}, 8_000);

ws.addEventListener("open", async () => {
  ws.send(JSON.stringify({ kind: "subscribe", ...identity }));
  await delay(150);

  const res = await fetch(publishUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((error) => fail(`publish request failed: ${error.message}`));

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(`publish request returned ${res.status}: ${body}`);
  }
});

ws.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.kind !== "turn") return;
  if (message.userId !== identity.userId) return;
  if (message.energy !== payload.energy) fail(`unexpected energy: ${message.energy}`);

  finished = true;
  clearTimeout(timeout);
  ws.close();
  console.log("[e2e] worker publish OK");
});

ws.addEventListener("error", () => {
  fail("watch websocket error");
});

ws.addEventListener("close", () => {
  if (!finished) fail("watch websocket closed before turn broadcast");
});

function toHttpPublishUrl(url) {
  const base = url.trim().replace(/\/$/, "");
  if (base.startsWith("ws://")) return `http://${base.slice("ws://".length)}/publish`;
  if (base.startsWith("wss://")) return `https://${base.slice("wss://".length)}/publish`;
  if (base.startsWith("http://") || base.startsWith("https://")) return `${base}/publish`;
  throw new Error(`Unsupported worker URL: ${url}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  try {
    ws.close();
  } catch {
    // ignore
  }
  console.error(`[e2e] ${message}`);
  process.exit(1);
}
