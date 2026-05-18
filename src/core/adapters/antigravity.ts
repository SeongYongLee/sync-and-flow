import { createStubSource } from "./stub.js";

export const antigravitySource = createStubSource({
  id: "antigravity",
  provider: "google",
  access: "json-snapshot",
  targets: [{ kind: "json-snapshot", dir: "~/.gemini/antigravity/conversations", glob: "**/*.json", intervalMs: 1000 }],
});
