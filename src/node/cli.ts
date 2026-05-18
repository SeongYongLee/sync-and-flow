import { MultiSourceWatcher } from "./sources/multi-source-watcher.js";
import { Aggregator } from "../core/aggregate.js";

const cwd = process.argv.includes("--cwd")
  ? process.argv[process.argv.indexOf("--cwd") + 1] ?? process.cwd()
  : process.cwd();

const backfill = process.argv.includes("--backfill");

console.log(`[sync-and-flow] Watching sessions for: ${cwd}`);
console.log(`[sync-and-flow] Mode: ${backfill ? "backfill (historical)" : "from-now (live only)"}`);

const agg = new Aggregator();
const watcher = new MultiSourceWatcher();

watcher.onTurn((turn) => {
  if (!agg.ingest(turn)) return;
  const snapshot = agg.getSnapshot();
  const sourceTotals = snapshot.get(agg.totalKey(turn));
  if (!sourceTotals) return;
  const totals = agg.getCombinedTotals();

  const energy = agg.calcFlowEnergy(totals);
  const ts = new Date(turn.timestamp).toLocaleTimeString();

  console.log(`[${ts}] ${turn.source}:${turn.model}`);
  console.log(`  output: +${turn.usage.output_tokens} tokens → ${totals.outputTokens} local total`);
  console.log(`  source: ${sourceTotals.turns} turns → ${sourceTotals.outputTokens} output tokens`);
  console.log(`  cost:   $${totals.totalUsd.toFixed(6)}`);
  console.log(`  energy: ${energy.toFixed(1)} flow\n`);
});

await watcher.start({ cwd, fromNow: !backfill });

console.log("Watching... (Ctrl+C to stop)\n");

process.on("SIGINT", async () => {
  console.log("\n[sync-and-flow] Shutting down...");
  await watcher.stop();

  const snapshot = agg.getSnapshot();
  if (snapshot.size === 0) {
    console.log("No turns captured.");
  } else {
    console.log("\nSession summary:");
    for (const [key, t] of snapshot) {
      console.log(`  ${key}: ${t.turns} turns, $${t.totalUsd.toFixed(6)}`);
    }
  }
  process.exit(0);
});
