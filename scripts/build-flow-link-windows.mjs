import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") {
  console.error("[flow-link] Windows installers must be built on Windows.");
  console.error("[flow-link] Use the Flow Link Desktop GitHub Actions workflow or a Windows machine.");
  process.exit(1);
}

run("pnpm", ["--dir", "apps/flow-link", "exec", "tauri", "build", "--bundles", "nsis,msi"]);

const root = resolve(".");
const nsisDir = join(root, "apps/flow-link/src-tauri/target/release/bundle/nsis");
const downloadsDir = join(root, "public/downloads");
mkdirSync(downloadsDir, { recursive: true });

const installer = findFirst(nsisDir, ".exe");
if (installer) {
  const target = join(downloadsDir, "Flow-Link-Setup.exe");
  copyFileSync(installer, target);
  console.log(`[flow-link] copied ${target}`);
}

function findFirst(dir, extension) {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir)
    .filter((name) => name.endsWith(extension))
    .sort()
    .at(-1);
  return file ? join(dir, file) : null;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}
