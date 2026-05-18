import type { Source, SourceTarget } from "../../core/adapters/types.js";

export class SqlitePollDriver {
  constructor(
    readonly source: Source,
    readonly target: Extract<SourceTarget, { kind: "sqlite-poll" }>,
  ) {}

  async start(): Promise<void> {
    if (!this.source.implemented) return;
    throw new Error(`${this.source.id} sqlite-poll driver not implemented (Phase 2.5+)`);
  }

  async stop(): Promise<void> {}
}
