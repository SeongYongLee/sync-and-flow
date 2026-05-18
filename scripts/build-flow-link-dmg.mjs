import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(repoRoot, "apps/flow-link/src-tauri/target/release/bundle/macos/Flow Link.app");
const stagingDir = join(repoRoot, "apps/flow-link/src-tauri/target/release/bundle/dmg-staging");
const outputDir = join(repoRoot, "apps/flow-link/src-tauri/target/release/bundle/dmg");
const outputPath = join(outputDir, "Flow-Link.dmg");
const publicPath = join(repoRoot, "public/downloads/Flow-Link.dmg");
const createDmgScript = join(outputDir, "bundle_dmg.sh");
const signingIdentity = process.env.FLOW_LINK_CODESIGN_IDENTITY ?? "-";

run("pnpm", ["flow-link:desktop:build:app"]);

if (!existsSync(appPath)) {
  throw new Error(`Flow Link.app was not created at ${appPath}`);
}

run("codesign", ["--force", "--deep", "--sign", signingIdentity, appPath]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
cpSync(appPath, join(stagingDir, "Flow Link.app"), { recursive: true });

mkdirSync(outputDir, { recursive: true });
rmSync(outputPath, { force: true });
if (existsSync(createDmgScript)) {
  run(createDmgScript, [
    "--volname",
    "Flow Link",
    "--icon",
    "Flow Link.app",
    "180",
    "170",
    "--app-drop-link",
    "480",
    "170",
    "--window-size",
    "660",
    "400",
    "--hide-extension",
    "Flow Link.app",
    "Flow-Link.dmg",
    stagingDir,
  ], outputDir);
} else {
  run("hdiutil", [
    "create",
    "-ov",
    "-volname",
    "Flow Link",
    "-srcfolder",
    stagingDir,
    "-format",
    "UDZO",
    outputPath,
  ]);
}
run("hdiutil", ["verify", outputPath]);

mkdirSync(dirname(publicPath), { recursive: true });
cpSync(outputPath, publicPath);

console.log(`[flow-link] built ${outputPath}`);
console.log(`[flow-link] copied ${publicPath}`);

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}
