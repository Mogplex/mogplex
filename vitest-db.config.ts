import { defineConfig } from "vitest/config";

// Isolated config for the pglite-backed DB trigger battery. Lives in its own
// config so `pnpm test` (lib/** only) stays fast and Docker-free, while
// `pnpm test:db` opts in to the WASM + migration bootstrap path.
//
// We intentionally don't `mergeConfig` with the base — Vitest's array merge
// would concat `include`, dragging the lib/** suite into `pnpm test:db`. The
// only base setting the DB suite actually needs is the `@` alias, which is
// re-declared here.
export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
    },
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
  },
});
