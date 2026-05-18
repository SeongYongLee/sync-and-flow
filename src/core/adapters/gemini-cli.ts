import { createStubSource } from "./stub.js";

export const geminiCliSource = createStubSource({
  id: "gemini-cli",
  provider: "google",
  access: "jsonl-tail",
  targets: [{ kind: "jsonl-tail", dir: "~/.gemini/tmp", glob: "**/chats/**/*", depth: 6, match: (path) => path.endsWith(".jsonl") || path.endsWith(".json") }],
});
