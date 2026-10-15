import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next.js preserves JSX for its compiler; the test runner needs the React transform.
  oxc: { jsx: { runtime: "automatic" } },
  test: { environment: "node" },
});
