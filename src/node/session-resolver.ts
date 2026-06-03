import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { sessionDir, projectsDir } from "../core/paths.js";
import { isSessionFile } from "./tail.js";

export async function resolveSessionDir(cwd: string): Promise<string | null> {
  const dir = sessionDir(cwd);
  try {
    await stat(dir);
    return dir;
  } catch {
    // fallback: search all project dirs for the cwd substring
    const encoded = cwd.replace(/\//g, "-");
    const all = await readdir(projectsDir()).catch(() => []);
    for (const entry of all) {
      if (entry.includes(encoded.slice(1))) {
        return join(projectsDir(), entry);
      }
    }
    return null;
  }
}

export async function findLatestSessionFile(dir: string): Promise<string | null> {
  const entries = await readdir(dir).catch(() => []);
  const jsonls = entries.filter(isSessionFile);
  if (!jsonls.length) return null;

  let latest = "";
  let latestMtime = 0;
  for (const name of jsonls) {
    const s = await stat(join(dir, name)).catch(() => null);
    if (s && s.mtimeMs > latestMtime) {
      latestMtime = s.mtimeMs;
      latest = name;
    }
  }

  return latest ? join(dir, latest) : null;
}
