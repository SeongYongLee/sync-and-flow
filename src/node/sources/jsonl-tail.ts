import chokidar from "chokidar";
import { readFile, stat } from "node:fs/promises";
import { FileTail } from "../tail.js";
import type { Source, SourceAdapter, SourceTarget } from "../../core/adapters/types.js";
import type { ExtractedTurn } from "../../core/types.js";
import { expandHome } from "./registry.js";

export type SourceTurnHandler = (turn: ExtractedTurn) => void;

export class JsonlTailDriver {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private tails = new Map<string, { tail: FileTail; adapter: SourceAdapter }>();
  private pendingAdds = new Set<Promise<void>>();

  constructor(
    private readonly source: Source,
    private readonly target: Extract<SourceTarget, { kind: "jsonl-tail" }>,
    private readonly fromNow = true,
  ) {}

  async start(onTurn: SourceTurnHandler): Promise<void> {
    const dir = expandHome(this.target.dir);
    const adapterByFile = new Map<string, SourceAdapter>();

    this.watcher = chokidar.watch(dir, {
      depth: this.target.depth ?? 0,
      ignoreInitial: false,
      awaitWriteFinish: false,
      usePolling: true,
      interval: 100,
    });

    this.watcher.on("add", (filePath: string) => {
      if (!this.target.match(filePath)) return;

      const pending = (async () => {
        const adapter = adapterByFile.get(filePath) ?? this.source.createAdapter();
        adapterByFile.set(filePath, adapter);

        const startPos = this.fromNow ? await this.seedAndGetSize(filePath, adapter) : 0;
        const tail = new FileTail(filePath, startPos);
        this.tails.set(filePath, { tail, adapter });

        if (!this.fromNow) {
          const lines = await tail.pull();
          for (const line of lines) {
            const turns = adapter.ingestLine?.(line, { filePath }) ?? [];
            for (const turn of turns) onTurn(turn);
          }
        }
      })().finally(() => {
        this.pendingAdds.delete(pending);
      });

      this.pendingAdds.add(pending);
    });

    this.watcher.on("change", async (filePath: string) => {
      if (!this.target.match(filePath)) return;
      const entry = this.tails.get(filePath);
      if (!entry) return;

      const lines = await entry.tail.pull();
      for (const line of lines) {
        const turns = entry.adapter.ingestLine?.(line, { filePath }) ?? [];
        for (const turn of turns) onTurn(turn);
      }
    });

    this.watcher.on("error", (error) => {
      console.warn(`[jsonl-tail:${this.source.id}] ${error instanceof Error ? error.message : String(error)}`);
    });

    await new Promise<void>((resolve) => {
      this.watcher?.once("ready", () => resolve());
    });
    await Promise.all([...this.pendingAdds]);
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    await Promise.all([...this.pendingAdds]);
    this.pendingAdds.clear();
    for (const { tail } of this.tails.values()) await tail.close();
    this.tails.clear();
  }

  private async seedAndGetSize(filePath: string, adapter: SourceAdapter): Promise<number> {
    const [s, content] = await Promise.all([
      stat(filePath).catch(() => null),
      adapter.seedFile ? readFile(filePath, "utf-8").catch(() => "") : Promise.resolve(""),
    ]);
    if (content) adapter.seedFile?.(filePath, content);
    return s?.size ?? 0;
  }
}
