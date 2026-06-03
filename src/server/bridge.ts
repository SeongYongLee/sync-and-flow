import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { MultiSourceWatcher } from "../node/sources/multi-source-watcher.js";
import { Aggregator } from "../core/aggregate.js";
import { getBridgeIdentity } from "./identity.js";
import { WorkerPublisher } from "./worker-publisher.js";
import { classifyPlanet, recordPlanetStateUse, type WirePlanetState } from "../shared/planet.js";

const PORT = Number(process.env["PORT"] ?? 3001);
const WORKER_URL = process.env["SYNC_FLOW_WORKER_URL"] ?? "ws://localhost:8787";
const BRIDGE_TOKEN = process.env["SYNC_FLOW_BRIDGE_TOKEN"] ?? randomUUID();
const cwd = process.argv.includes("--cwd")
  ? process.argv[process.argv.indexOf("--cwd") + 1] ?? process.cwd()
  : process.cwd();

const clients = new Set<ServerResponse>();

function broadcast(data: unknown) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

const agg = new Aggregator();
const watcher = new MultiSourceWatcher();
const identity = await getBridgeIdentity();
const publisher = new WorkerPublisher(WORKER_URL, identity);
let lastModel = "";
let lastSource = "";
let planetState: WirePlanetState | undefined;

publisher.start();

watcher.onTurn((turn) => {
  if (!agg.ingest(turn)) return;
  const sourceTotals = agg.getSnapshot().get(agg.totalKey(turn));
  if (!sourceTotals) return;
  const totals = agg.getCombinedTotals();
  lastModel = turn.model;
  lastSource = turn.source;
  const turnTime = Date.parse(turn.timestamp);
  planetState = recordPlanetStateUse(planetState, classifyPlanet(turn.source, turn.model), turn.usage.output_tokens, Number.isFinite(turnTime) ? turnTime : Date.now());

  const event = {
    type: "turn",
    source: turn.source,
    provider: turn.provider,
    model: turn.model,
    delta: {
      outputTokens: turn.usage.output_tokens,
      inputTokens: turn.usage.input_tokens,
      cacheReadTokens: turn.usage.cache_read_input_tokens,
    },
    totals: {
      outputTokens: totals.outputTokens,
      inputTokens: totals.inputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      turns: totals.turns,
      totalUsd: totals.totalUsd,
    },
    sourceTotals: {
      outputTokens: sourceTotals.outputTokens,
      inputTokens: sourceTotals.inputTokens,
      cacheReadTokens: sourceTotals.cacheReadTokens,
      turns: sourceTotals.turns,
      totalUsd: sourceTotals.totalUsd,
    },
    energy: agg.calcFlowEnergy(totals),
    timestamp: turn.timestamp,
    planetState,
  };

  broadcast(event);
  publisher.publish({
    source: event.source,
    provider: event.provider,
    model: event.model,
    delta: event.delta,
    totals: event.totals,
    energy: event.energy,
    timestamp: event.timestamp,
  });
});

await watcher.start({ cwd, fromNow: true });

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `127.0.0.1:${PORT}`}`);
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;

  if (origin && !isAllowedOrigin(origin)) {
    writeEmpty(res, 403, origin);
    return;
  }

  if (req.method === "OPTIONS") {
    writeEmpty(res, 204, origin);
    return;
  }

  if (!isAuthorized(req, url)) {
    writeEmpty(res, 401, origin);
    return;
  }

  if (url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...corsHeaders(origin),
    });
    res.write(": connected\n\n");
    clients.add(res);

    const combined = agg.getCombinedTotals();
    if (combined.turns > 0) {
      const snapshot = {
        type: "snapshot",
        model: lastModel,
        source: lastSource,
        totals: {
          outputTokens: combined.outputTokens,
          inputTokens: combined.inputTokens,
          cacheReadTokens: combined.cacheReadTokens,
          turns: combined.turns,
          totalUsd: combined.totalUsd,
        },
        energy: agg.calcFlowEnergy(combined),
        planetState,
      };
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    }

    req.on("close", () => {
      clients.delete(res);
    });
    return;
  }

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders(origin) });
    res.end(JSON.stringify({ ok: true, cwd, sources: watcher.getActiveSourceIds(), clients: clients.size, workerUrl: WORKER_URL, identity }));
    return;
  }

  if (url.pathname === "/identity") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    });
    res.end(JSON.stringify(identity));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[bridge] SSE server on http://localhost:${PORT}/events`);
  console.log(`[bridge] Browser URL token: bridgeToken=${BRIDGE_TOKEN}`);
  console.log(`[bridge] Watching cwd: ${cwd}`);
});

process.on("SIGINT", async () => {
  publisher.stop();
  await watcher.stop();
  server.close();
  process.exit(0);
});

function isAuthorized(req: IncomingMessage, url: URL): boolean {
  if (url.searchParams.get("token") === BRIDGE_TOKEN) return true;
  const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  return authorization === `Bearer ${BRIDGE_TOKEN}`;
}

function writeEmpty(res: ServerResponse, status: number, origin?: string): void {
  res.writeHead(status, corsHeaders(origin));
  res.end();
}

function corsHeaders(origin?: string): Record<string, string> {
  if (!origin || !isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

function isAllowedOrigin(origin: string): boolean {
  if (origin === "http://127.0.0.1:5175" || origin === "http://localhost:5175" || origin === "http://127.0.0.1:5173" || origin === "http://localhost:5173") {
    return true;
  }

  try {
    const url = new URL(origin);
    return url.protocol === "http:" && url.port === "5175" && isPrivateLanHost(url.hostname);
  } catch {
    return false;
  }
}

function isPrivateLanHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const match = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}
