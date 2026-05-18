import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { parseLine } from "../src/core/parse.js";
import { CodexAdapter } from "../src/core/adapters/codex.js";
import { Aggregator } from "../src/core/aggregate.js";
import type { ExtractedTurn, SourceId } from "../src/core/types.js";

const args = process.argv.slice(2);
const source = parseSource(args);
const filePath = args.at(-1);

if (!filePath) {
  console.error("Usage: pnpm replay [--source claude|codex] <path-to-session.jsonl>");
  process.exit(1);
}

const agg = new Aggregator();
const parser = createParser(source);
const counts = { total: 0, parsed: 0, skipped: 0, parseError: 0, deduped: 0 };

const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });

rl.on("line", (raw) => {
  const trimmed = raw.trim();
  if (!trimmed) return;
  counts.total++;

  let turns: ExtractedTurn[];
  try {
    turns = parser(trimmed);
  } catch {
    counts.parseError++;
    return;
  }

  if (turns.length === 0) {
    counts.skipped++;
    return;
  }

  for (const turn of turns) {
    const key = agg.totalKey(turn);
    const sizeBefore = agg.getSnapshot().get(key)?.turns ?? 0;
    agg.ingest(turn);
    const sizeAfter = agg.getSnapshot().get(key)?.turns ?? 0;

    if (sizeAfter === sizeBefore) {
      counts.deduped++;
    } else {
      counts.parsed++;
    }
  }
});

rl.on("close", () => {
  const snapshot = agg.getSnapshot();

  console.log("\n═══════════════════════════════════════");
  console.log("  Sync and Flow — Replay Report");
  console.log("═══════════════════════════════════════");
  console.log(`  Source: ${source}`);
  console.log(`  File: ${filePath}`);
  console.log(`\n  Line classification:`);
  console.log(`    Total lines:         ${counts.total}`);
  console.log(`    Parse errors:        ${counts.parseError}  ← must be 0`);
  console.log(`    Skipped:             ${counts.skipped}`);
  console.log(`    Deduped (skipped):   ${counts.deduped}`);
  console.log(`    Unique turns:        ${counts.parsed}`);

  console.log(`\n  Per-source/model totals:`);
  for (const [key, t] of snapshot) {
    console.log(`\n  ┌─ ${key}`);
    console.log(`  │  Turns:          ${t.turns}`);
    console.log(`  │  Input tokens:   ${t.inputTokens.toLocaleString()}`);
    console.log(`  │  Output tokens:  ${t.outputTokens.toLocaleString()}`);
    console.log(`  │  Cache create:   ${t.cacheCreationTokens.toLocaleString()}`);
    console.log(`  └─ Cache read:     ${t.cacheReadTokens.toLocaleString()}`);
  }

  console.log("═══════════════════════════════════════\n");

  if (counts.parseError > 0) {
    console.error(`FAIL: ${counts.parseError} parse error(s) — check fixtures`);
    process.exit(1);
  }
});

function parseSource(args: string[]): SourceId {
  const sourceIndex = args.indexOf("--source");
  if (sourceIndex === -1) return "claude";

  const value = args[sourceIndex + 1];
  args.splice(sourceIndex, 2);

  if (value === "claude" || value === "codex") return value;
  console.error(`Unsupported replay source: ${value}`);
  process.exit(1);
}

function createParser(source: SourceId): (raw: string) => ExtractedTurn[] {
  if (source === "claude") {
    return (raw) => {
      const turn = parseLine(raw);
      return turn ? [turn] : [];
    };
  }

  if (source === "codex") {
    const adapter = new CodexAdapter();
    return (raw) => adapter.ingestLine(raw);
  }

  return () => [];
}
