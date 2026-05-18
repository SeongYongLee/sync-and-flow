import { JsonlTailDriver, type SourceTurnHandler } from "./jsonl-tail.js";
import { getActiveSources, sourceIds } from "./registry.js";
import type { Source } from "../../core/adapters/types.js";
import type { ExtractedTurn } from "../../core/types.js";

export type MultiSourceHandler = (turn: ExtractedTurn) => void;
export type ActiveSourcesResolver = (opts: { cwd?: string }) => Promise<Source[]>;

export class MultiSourceWatcher {
  private drivers: JsonlTailDriver[] = [];
  private handlers: MultiSourceHandler[] = [];
  private activeSources: Source[] = [];

  constructor(private readonly resolveActiveSources: ActiveSourcesResolver = getActiveSources) {}

  onTurn(handler: MultiSourceHandler): void {
    this.handlers.push(handler);
  }

  getActiveSourceIds(): string[] {
    return this.activeSources.map((source) => source.id);
  }

  async start(opts: { cwd?: string; fromNow?: boolean } = {}): Promise<void> {
    const cwd = opts.cwd ?? process.cwd();
    const fromNow = opts.fromNow ?? true;

    this.activeSources = await this.resolveActiveSources({ cwd });
    console.log(`[watcher] active sources: ${sourceIds(this.activeSources) || "none"}`);

    const onTurn: SourceTurnHandler = (turn) => {
      for (const handler of this.handlers) handler(turn);
    };

    for (const source of this.activeSources) {
      for (const target of source.targets({ cwd })) {
        if (target.kind !== "jsonl-tail") {
          console.warn(`[watcher] ${source.id} target ${target.kind} is not supported yet`);
          continue;
        }

        const driver = new JsonlTailDriver(source, target, fromNow);
        this.drivers.push(driver);
        await driver.start(onTurn);
      }
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.drivers.map((driver) => driver.stop()));
    this.drivers = [];
    this.activeSources = [];
  }
}
