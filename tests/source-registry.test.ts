import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getActiveSources, getRegisteredSources } from "../src/node/sources/registry.js";

const originalCodexHome = process.env["CODEX_HOME"];
const tempDirs: string[] = [];

afterEach(() => {
  if (originalCodexHome === undefined) {
    delete process.env["CODEX_HOME"];
  } else {
    process.env["CODEX_HOME"] = originalCodexHome;
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("source registry", () => {
  it("registers all Phase 2 sources", () => {
    const sources = getRegisteredSources();
    expect(sources.map((source) => source.id)).toEqual([
      "claude",
      "codex",
      "cursor-agent",
      "gemini-cli",
      "antigravity",
      "cursor",
      "claude-desktop",
      "copilot",
    ]);
  });

  it("keeps non-Claude/Codex sources as inactive stubs", () => {
    const stubs = getRegisteredSources().filter((source) => source.id !== "claude" && source.id !== "codex");
    expect(stubs).toHaveLength(6);
    expect(stubs.every((source) => source.implemented === false)).toBe(true);
    expect(() => stubs[0]!.createAdapter().ingestLine?.("{}")).toThrow("not implemented");
  });

  it("activates implemented available sources and excludes inactive stubs", async () => {
    const root = mkdtempSync(join(tmpdir(), "snf-registry-"));
    tempDirs.push(root);

    const codexHome = join(root, "codex-home");
    mkdirSync(codexHome, { recursive: true });
    process.env["CODEX_HOME"] = codexHome;

    const active = await getActiveSources({ cwd: join(root, "workspace") });
    const ids = active.map((source) => source.id);

    expect(ids).toContain("codex");
    expect(ids).not.toContain("cursor-agent");
    expect(ids).not.toContain("gemini-cli");
    expect(ids).not.toContain("antigravity");
    expect(ids).not.toContain("cursor");
    expect(ids).not.toContain("claude-desktop");
    expect(ids).not.toContain("copilot");
  });
});
