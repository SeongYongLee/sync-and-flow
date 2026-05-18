import type { Source, SourceTarget } from "../../core/adapters/types.js";

export class JsonSnapshotDriver {
  constructor(
    readonly source: Source,
    readonly target: Extract<SourceTarget, { kind: "json-snapshot" }>,
  ) {}

  async start(): Promise<void> {
    if (!this.source.implemented) return;
    throw new Error(`${this.source.id} json-snapshot driver not implemented (Phase 2.5+)`);
  }

  async stop(): Promise<void> {}
}
