import type { Source, SourceAdapter, SourceTarget } from "./types.js";
import type { Provider, SourceId } from "../types.js";

export function createStubSource(options: {
  id: SourceId;
  provider: Provider;
  access: Source["access"];
  targets: SourceTarget[];
}): Source {
  return {
    id: options.id,
    provider: options.provider,
    access: options.access,
    implemented: false,
    async isAvailable(): Promise<boolean> {
      return false;
    },
    targets(): SourceTarget[] {
      return options.targets;
    },
    createAdapter(): SourceAdapter {
      return {
        sourceId: options.id,
        ingestLine: notImplemented(options.id),
        ingestRows: notImplemented(options.id),
        ingestFile: notImplemented(options.id),
      };
    },
  };
}

function notImplemented(sourceId: SourceId) {
  return (): never => {
    throw new Error(`${sourceId} adapter not implemented (Phase 2.5+)`);
  };
}
