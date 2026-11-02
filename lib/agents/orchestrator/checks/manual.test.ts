import { expect, it } from "vitest";
import { buildRepositoryCheckPlan } from "./plan";
import { matchRepositoryCheckCommand } from "./manual";

const plan = buildRepositoryCheckPlan({
  packageManager: "pnpm@10.12.4",
  scripts: {
    typecheck: "tsc --noEmit",
    lint: "eslint .",
    build: "next build",
    "test:all": "vitest run",
  },
  lockfiles: ["pnpm-lock.yaml"],
});

it.each([
  ["pnpm typecheck", "typecheck"],
  ["pnpm run typecheck", "typecheck"],
  ["CI=1 pnpm run lint", "lint"],
  ["pnpm build", "build"],
  ["pnpm run test:all", "test"],
] as const)("accepts the full project check %s", (command, kind) => {
  expect(matchRepositoryCheckCommand(command, undefined, plan)).toBe(kind);
  expect(matchRepositoryCheckCommand(command, ".", plan)).toBe(kind);
});

it.each([
  "pnpm typecheck --filter web",
  "pnpm lint src/changed.ts",
  "pnpm run test:all tests/changed.test.ts",
  "pnpm lint | head -n 10",
  "pnpm lint || true",
  "pnpm lint && pnpm build",
  "pnpm lint\npnpm build",
  "echo pnpm typecheck",
  "npm run lint",
  "pnpm test",
])(
  "does not count scoped, filtered, substituted, or partial command %s",
  (command) => {
    expect(matchRepositoryCheckCommand(command, undefined, plan)).toBeNull();
  }
);

it("does not attest a command against a different directory's manifest", () => {
  expect(matchRepositoryCheckCommand("pnpm lint", "apps/web", plan)).toBeNull();
  expect(
    matchRepositoryCheckCommand("pnpm lint", "/workspace/other", plan)
  ).toBeNull();
});

it.each(["npm", "yarn", "bun"])(
  "follows %s script invocation rules",
  (manager) => {
    const selected = buildRepositoryCheckPlan({
      packageManager: `${manager}@1.0.0`,
      scripts: { lint: "eslint .", test: "vitest run" },
      lockfiles: [],
    });
    expect(
      matchRepositoryCheckCommand(`${manager} run lint`, "./", selected)
    ).toBe("lint");
    expect(
      matchRepositoryCheckCommand(`${manager} test`, undefined, selected)
    ).toBe("test");
    expect(
      matchRepositoryCheckCommand(`${manager} lint`, undefined, selected)
    ).toBe(manager === "npm" ? null : "lint");
    expect(
      matchRepositoryCheckCommand("pnpm lint", undefined, selected)
    ).toBeNull();
  }
);
