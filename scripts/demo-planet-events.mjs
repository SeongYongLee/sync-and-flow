const workerBase = process.argv[2] ?? "http://127.0.0.1:8787";
const publishUrl = toHttpPublishUrl(workerBase);

const sequence = [
  { source: "claude", provider: "anthropic", model: "claude-sonnet-4-6", outputTokens: 160 },
  { source: "codex", provider: "openai", model: "gpt-5-codex", outputTokens: 260 },
  { source: "gemini-cli", provider: "google", model: "gemini-pro", outputTokens: 190 },
  { source: "copilot", provider: "github", model: "gpt-4.1", outputTokens: 220 },
  { source: "cursor", provider: "openai", model: "cursor-agent", outputTokens: 180 },
];

let totals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  turns: 0,
  totalUsd: 0,
};

for (const item of sequence) {
  totals = {
    ...totals,
    inputTokens: totals.inputTokens + Math.round(item.outputTokens * 0.7),
    outputTokens: totals.outputTokens + item.outputTokens,
    turns: totals.turns + 1,
  };

  const body = {
    kind: "publish",
    userId: "planet-demo",
    nickname: "Planet Demo",
    color: "#80b4ff",
    source: item.source,
    provider: item.provider,
    model: item.model,
    delta: {
      inputTokens: Math.round(item.outputTokens * 0.7),
      outputTokens: item.outputTokens,
      cacheReadTokens: 0,
    },
    totals,
    energy: totals.outputTokens,
    timestamp: new Date().toISOString(),
  };

  const res = await fetch(publishUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`publish failed: HTTP ${res.status} ${await res.text()}`);
  console.log(`[demo] ${item.source}:${item.model} ${item.outputTokens} output tokens`);
  await new Promise((resolve) => setTimeout(resolve, 1_200));
}

console.log(`[demo] published ${sequence.length} planet transitions to ${publishUrl}`);

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
