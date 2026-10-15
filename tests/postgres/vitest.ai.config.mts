import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: {
    "@vichaar/agents": fileURLToPath(new URL("../../packages/agents/src/index.ts", import.meta.url)),
  } },
  test: {
    include: ["tests/postgres/ai-pipeline.test.ts"],
    environment: "node", fileParallelism: false, testTimeout: 15000, hookTimeout: 15000,
    env: { OPENAI_AGENTS_DISABLE_TRACING: "1", OPENAI_API_KEY: "unused-mocked-ai-key", NEXT_PUBLIC_API_URL: "http://127.0.0.1:4000" },
  },
});
