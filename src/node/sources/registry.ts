import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { claudeSource } from "../../core/adapters/claude.js";
import { codexSource } from "../../core/adapters/codex.js";
import { cursorAgentSource } from "../../core/adapters/cursor-agent.js";
import { geminiCliSource } from "../../core/adapters/gemini-cli.js";
import { antigravitySource } from "../../core/adapters/antigravity.js";
import { cursorSource } from "../../core/adapters/cursor.js";
import { claudeDesktopSource } from "../../core/adapters/claude-desktop.js";
import { copilotSource } from "../../core/adapters/copilot.js";
import type { Source } from "../../core/adapters/types.js";
import { resolveSessionDir } from "../session-resolver.js";
import { isSessionFile } from "../tail.js";

export const SOURCES: Source[] = [
  claudeSource,
  codexSource,
  cursorAgentSource,
  geminiCliSource,
  antigravitySource,
  cursorSource,
  claudeDesktopSource,
  copilotSource,
];

export function getRegisteredSources(): Source[] {
  return [...SOURCES];
}

export async function getActiveSources(opts: { cwd?: string } = {}): Promise<Source[]> {
  const sources = await Promise.all(SOURCES.map((source) => materializeSource(source, opts)));
  const active: Source[] = [];

  for (const source of sources) {
    if (!source.implemented) continue;
    if (await source.isAvailable()) active.push(source);
  }

  return active;
}

async function materializeSource(source: Source, opts: { cwd?: string }): Promise<Source> {
  if (source.id !== "claude") return source;

  const cwd = opts.cwd ?? process.cwd();
  const dir = await resolveSessionDir(cwd);
  if (!dir) {
    return { ...source, async isAvailable() { return false; }, targets: () => [] };
  }

  return {
    ...source,
    async isAvailable(): Promise<boolean> {
      try {
        await stat(dir);
        const entries = await readdir(dir);
        return entries.some(isSessionFile);
      } catch {
        return false;
      }
    },
    targets() {
      return [
        {
          kind: "jsonl-tail" as const,
          dir,
          depth: 0,
          match: (path: string) => isSessionFile(basename(path)),
        },
      ];
    },
  };
}

export function sourceIds(sources: Source[]): string {
  return sources.map((source) => source.id).join(", ");
}

export function expandHome(path: string): string {
  if (!path.startsWith("~/")) return path;
  return join(process.env["HOME"] ?? "", path.slice(2));
}
