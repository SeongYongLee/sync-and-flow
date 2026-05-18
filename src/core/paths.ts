import { homedir } from "node:os";
import { join } from "node:path";

export function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

export function projectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

export function sessionDir(cwd: string): string {
  return join(projectsDir(), encodeCwd(cwd));
}
