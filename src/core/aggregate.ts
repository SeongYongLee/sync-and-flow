import type { ExtractedTurn, RunningTotals, TurnCost } from "./types.js";
import { calcCost } from "./pricing.js";
import { Deduplicator } from "./dedup.js";

export type TurnHandler = (turn: ExtractedTurn, cost: TurnCost) => void;
export type TotalHandler = (totals: Map<string, RunningTotals>) => void;

export class Aggregator {
  private totals = new Map<string, RunningTotals>();
  private dedup = new Deduplicator();
  private onTurnHandlers: TurnHandler[] = [];
  private onTotalHandlers: TotalHandler[] = [];

  onTurn(handler: TurnHandler): void {
    this.onTurnHandlers.push(handler);
  }

  onTotal(handler: TotalHandler): void {
    this.onTotalHandlers.push(handler);
  }

  ingest(turn: ExtractedTurn): boolean {
    if (!this.dedup.accept(turn)) return false;

    const cost = turn.provider === "anthropic" ? calcCost(turn.model, turn.usage) : zeroCost();
    const totalKey = this.totalKey(turn);

    let totals = this.totals.get(totalKey);
    if (!totals) {
      totals = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, turns: 0, totalUsd: 0 };
      this.totals.set(totalKey, totals);
    }

    totals.inputTokens += turn.usage.input_tokens;
    totals.outputTokens += turn.usage.output_tokens;
    totals.cacheCreationTokens += turn.usage.cache_creation_input_tokens;
    totals.cacheReadTokens += turn.usage.cache_read_input_tokens;
    totals.turns += 1;
    totals.totalUsd += cost.totalUsd;

    for (const h of this.onTurnHandlers) h(turn, cost);
    for (const h of this.onTotalHandlers) h(this.totals);
    return true;
  }

  getSnapshot(): Map<string, RunningTotals> {
    return new Map(this.totals);
  }

  getCombinedTotals(): RunningTotals {
    const combined = emptyTotals();
    for (const totals of this.totals.values()) {
      combined.inputTokens += totals.inputTokens;
      combined.outputTokens += totals.outputTokens;
      combined.cacheCreationTokens += totals.cacheCreationTokens;
      combined.cacheReadTokens += totals.cacheReadTokens;
      combined.turns += totals.turns;
      combined.totalUsd += totals.totalUsd;
    }
    return combined;
  }

  // game resource formula (PoC placeholder)
  calcFlowEnergy(totals: RunningTotals): number {
    return totals.outputTokens * 1 + totals.cacheReadTokens * 0.1;
  }

  reset(): void {
    this.totals.clear();
    this.dedup.reset();
  }

  totalKey(turn: ExtractedTurn): string {
    return `${turn.source}:${turn.model}`;
  }
}

function zeroCost(): TurnCost {
  return {
    inputUsd: 0,
    outputUsd: 0,
    cacheCreate5mUsd: 0,
    cacheCreate1hUsd: 0,
    cacheReadUsd: 0,
    totalUsd: 0,
  };
}

function emptyTotals(): RunningTotals {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, turns: 0, totalUsd: 0 };
}
