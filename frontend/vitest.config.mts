import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolves the "@/..." alias from tsconfig, so tests import modules by the
    // same specifier the app does rather than by relative path. Native in Vite
    // now; the vite-tsconfig-paths plugin is no longer needed for this.
    tsconfigPaths: true,
  },
  test: {
    // Node, not jsdom: everything covered here is pure logic. The components
    // that genuinely need a DOM were verified in a real browser instead, and
    // adding jsdom for their sake would buy a worse approximation of it.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
