import { parseClaudeLine } from "./adapters/claude.js";
import type { ExtractedTurn } from "./types.js";

export function parseLine(raw: string): ExtractedTurn | null {
  return parseClaudeLine(raw);
}
