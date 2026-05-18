import { createStubSource } from "./stub.js";

export const copilotSource = createStubSource({
  id: "copilot",
  provider: "github",
  access: "json-snapshot",
  targets: [{ kind: "json-snapshot", dir: "~/.copilot/session-state", glob: "**/*.json", intervalMs: 1000 }],
});
