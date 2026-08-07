import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolves the "@/..." alias from tsconfig, so tests import modules by the
    // same specifier the app does rather than by relative path. Native in Vite
    // now; the vite-tsconfig-paths plugin is no longer needed for this.
    tsconfigPaths: true,
  },
  test: {
    // Node by default: most of what is covered here is pure logic, and jsdom
    // costs real startup time for tests that never touch a DOM. The files that
    // do -- focus traps, keyboard handling -- opt in per file with
    // `// @vitest-environment jsdom` on the first line.
    //
    // jsdom earns its place for exactly the behaviour a browser cannot be
    // relied on to demonstrate on demand: Escape and Tab through a focus trap
    // need a focused window, and a headless or unattended browser has none.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // Threads, not the default forks. Booting jsdom inside a forked child
    // exceeded the worker startup timeout on Windows and the run died before a
    // single test executed.
    pool: "threads",
  },
});
