import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
    },
  },
  test: {
    environment: "node",
    // tests/unit/** uses node:test syntax and is run by `pnpm test:unit`.
    // tests/db/** is an isolated pglite-backed suite run via `pnpm test:db`
    // (see vitest-db.config.ts) — keeping it out of the default include keeps
    // `pnpm test` lib-only and fast, and matches the PR #527 description that
    // DB tests are gated behind their own script until CI wiring lands.
    include: ["lib/**/*.test.ts"],
  },
});
