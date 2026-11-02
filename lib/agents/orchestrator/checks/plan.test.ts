import { expect, it } from "vitest";
import { buildRepositoryCheckPlan } from "./plan";

it("selects the repository's full scripts and declared package manager", () => {
  const plan = buildRepositoryCheckPlan({
    packageManager: "pnpm@10.12.4",
    scripts: {
      typecheck: "tsc --noEmit",
      lint: "eslint .",
      build: "next build",
      test: "vitest run",
      "test:all": "pnpm test && pnpm test:unit && pnpm test:db",
    },
    lockfiles: ["package-lock.json", "pnpm-lock.yaml"],
  });
  expect(plan).toEqual([
    { kind: "typecheck", command: "CI=1 pnpm run typecheck" },
    { kind: "lint", command: "CI=1 pnpm run lint" },
    { kind: "build", command: "CI=1 pnpm run build" },
    { kind: "test", command: "CI=1 pnpm run test:all" },
  ]);
});

it("prefers CI scripts and infers the manager only from an unambiguous lockfile", () => {
  const plan = buildRepositoryCheckPlan({
    scripts: {
      "type-check": "tsc -b",
      lint: "eslint .",
      "lint:ci": "eslint . --max-warnings 0",
      build: "vite build",
      test: "vitest",
      "test:ci": "vitest run",
    },
    lockfiles: ["yarn.lock"],
  });
  expect(plan.map((check) => check.command)).toEqual([
    "CI=1 yarn run type-check",
    "CI=1 yarn run lint:ci",
    "CI=1 yarn run build",
    "CI=1 yarn run test:ci",
  ]);
});

it("reports missing checks instead of inventing narrower compiler or lint commands", () => {
  const plan = buildRepositoryCheckPlan({
    scripts: { build: "next build" },
    lockfiles: [],
  });
  expect(plan.find((check) => check.kind === "build")?.command).toBe(
    "CI=1 npm run build"
  );
  expect(
    plan.filter((check) => !check.command).map((check) => check.kind)
  ).toEqual(["typecheck", "lint", "test"]);
  expect(plan.find((check) => check.kind === "typecheck")?.reason).toMatch(
    /No .*script/
  );
});

it("does not guess when package manager metadata is conflicting or unsupported", () => {
  for (const input of [
    { packageManager: "other@1", scripts: { build: "build" }, lockfiles: [] },
    { scripts: { build: "build" }, lockfiles: ["pnpm-lock.yaml", "yarn.lock"] },
  ]) {
    const plan = buildRepositoryCheckPlan(input);
    expect(plan).toHaveLength(4);
    expect(plan.every((check) => !check.command)).toBe(true);
    expect(
      plan.every((check) => check.reason?.includes("package manager"))
    ).toBe(true);
  }
});

it("never interpolates untrusted manifest values into shell command syntax", () => {
  const plan = buildRepositoryCheckPlan({
    packageManager: "pnpm@10; touch /tmp/unsafe",
    scripts: {
      typecheck: "echo ; unsafe",
      lint: "lint",
      build: "build",
      test: "test",
    },
    lockfiles: [],
  });
  expect(plan).toHaveLength(4);
  expect(plan.every((check) => !check.command)).toBe(true);
});
