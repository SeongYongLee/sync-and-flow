import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/events": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/identity": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/core/**/*.ts", "src/node/**/*.ts", "worker/src/sample.ts", "worker/src/room-state.ts"],
      exclude: [
        "**/*.d.ts",
        "src/core/types.ts",
        "src/core/adapters/types.ts",
        "src/core/adapters/antigravity.ts",
        "src/core/adapters/claude-desktop.ts",
        "src/core/adapters/copilot.ts",
        "src/core/adapters/cursor.ts",
        "src/core/adapters/cursor-agent.ts",
        "src/core/adapters/gemini-cli.ts",
        "src/core/adapters/stub.ts",
        "src/node/cli.ts",
        "src/node/sources/json-snapshot.ts",
        "src/node/sources/sqlite-poll.ts",
      ],
      thresholds: {
        statements: 75,
        branches: 60,
        functions: 75,
        lines: 75,
      },
    },
  },
});
