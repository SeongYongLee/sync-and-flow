import { createStubSource } from "./stub.js";

export const claudeDesktopSource = createStubSource({
  id: "claude-desktop",
  provider: "anthropic",
  access: "json-snapshot",
  targets: [{ kind: "json-snapshot", dir: "~/Library/Application Support/Claude/local-agent-mode-sessions", glob: "**/*.{json,jsonl}", intervalMs: 1000 }],
});
