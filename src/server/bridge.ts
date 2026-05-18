import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MultiSourceWatcher } from "../node/sources/multi-source-watcher.js";
import { Aggregator } from "../core/aggregate.js";
import { getBridgeIdentity } from "./identity.js";
import { WorkerPublisher } from "./worker-publisher.js";

const PORT = Number(process.env["PORT"] ?? 3001);
const WORKER_URL = process.env["SYNC_FLOW_WORKER_URL"] ?? "ws://localhost:8787";
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

publisher.start();

watcher.onTurn((turn) => {
  if (!agg.ingest(turn)) return;
  const sourceTotals = agg.getSnapshot().get(agg.totalKey(turn));
  if (!sourceTotals) return;
  const totals = agg.getCombinedTotals();
  lastModel = turn.model;
  lastSource = turn.source;

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
  if (req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
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
      };
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    }

    req.on("close", () => {
      clients.delete(res);
    });
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, cwd, sources: watcher.getActiveSourceIds(), clients: clients.size, workerUrl: WORKER_URL, identity }));
    return;
  }

  if (req.url === "/identity") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(identity));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[bridge] SSE server on http://localhost:${PORT}/events`);
  console.log(`[bridge] Watching cwd: ${cwd}`);
});

process.on("SIGINT", async () => {
  publisher.stop();
  await watcher.stop();
  server.close();
  process.exit(0);
});
