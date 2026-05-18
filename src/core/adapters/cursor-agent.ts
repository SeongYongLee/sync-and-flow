import { createStubSource } from "./stub.js";

export const cursorAgentSource = createStubSource({
  id: "cursor-agent",
  provider: "openai",
  access: "jsonl-tail",
  targets: [{ kind: "jsonl-tail", dir: "~/.cursor/projects", glob: "**/*.jsonl", depth: 5, match: (path) => path.endsWith(".jsonl") }],
});
