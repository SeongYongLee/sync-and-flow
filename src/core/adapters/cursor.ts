import { createStubSource } from "./stub.js";

export const cursorSource = createStubSource({
  id: "cursor",
  provider: "openai",
  access: "sqlite-poll",
  targets: [{ kind: "sqlite-poll", dbPath: "~/Library/Application Support/Cursor/User/globalStorage/state.vscdb", intervalMs: 1000 }],
});
