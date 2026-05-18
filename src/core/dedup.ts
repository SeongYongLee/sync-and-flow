import type { ExtractedTurn } from "./types.js";

const MAX_SIZE = 1024;

export class Deduplicator {
  private seen = new Set<string>();
  private queue: string[] = [];

  accept(turn: ExtractedTurn): boolean {
    const key = turn.dedupKey;
    if (!key || !key.includes(":")) {
      console.warn(`[dedup] Rejecting turn without source-prefixed dedupKey: ${key}`);
      return false;
    }

    if (this.seen.has(key)) return false;

    // evict oldest entry when at capacity
    if (this.seen.size >= MAX_SIZE) {
      const oldest = this.queue.shift();
      if (oldest !== undefined) this.seen.delete(oldest);
    }

    this.seen.add(key);
    this.queue.push(key);
    return true;
  }

  reset(): void {
    this.seen.clear();
    this.queue = [];
  }
}
