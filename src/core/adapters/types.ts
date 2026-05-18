import type { ExtractedTurn, Provider, SourceId } from "../types.js";

export type { Provider, SourceId };

export type AccessPattern = "jsonl-tail" | "sqlite-poll" | "json-snapshot";

export interface Source {
  readonly id: SourceId;
  readonly provider: Provider;
  readonly access: AccessPattern;
  readonly implemented: boolean;
  isAvailable(): Promise<boolean>;
  targets(opts: { cwd?: string }): SourceTarget[];
  createAdapter(): SourceAdapter;
}

export type SourceTarget =
  | {
      kind: "jsonl-tail";
      dir: string;
      glob?: string;
      depth?: number;
      match: (path: string) => boolean;
    }
  | { kind: "sqlite-poll"; dbPath: string; intervalMs: number }
  | { kind: "json-snapshot"; dir: string; glob: string; intervalMs: number };

export interface SourceAdapter {
  readonly sourceId: SourceId;
  seedFile?(path: string, content: string): void;
  ingestLine?(raw: string, context?: { filePath?: string }): ExtractedTurn[];
  ingestRows?(rows: unknown[]): ExtractedTurn[];
  ingestFile?(path: string, content: string): ExtractedTurn[];
}
