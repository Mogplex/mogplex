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
    // `pnpm test` focused and fast. The pending sandbox stream is included
    // explicitly so its direct test can stay beside the route implementation.
    // DB tests remain gated behind their own script until CI wiring lands.
    include: [
      "lib/**/*.test.ts",
      "app/api/sandbox/_lib/pending-stream.test.ts",
      "app/api/sandbox/_lib/baseline-fallback.test.ts",
    ],
    coverage: {
      // Consumed by the diff-coverage job in pr-protection.yml: cobertura XML
      // feeds diff-cover, which gates coverage on changed lines only. Scoped
      // to lib/** because that is the tier this config runs — app routes and
      // components are covered by tests/unit and e2e, which v8 coverage here
      // cannot see.
      provider: "v8",
      include: ["lib/**"],
      exclude: ["lib/**/*.test.ts", "lib/**/*.d.ts"],
      reporter: ["text-summary", "cobertura"],
      reportsDirectory: "coverage",
    },
  },
});
