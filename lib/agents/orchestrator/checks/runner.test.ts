import { expect, it } from "vitest";
import { buildRepositoryCheckPlan } from "./plan";
import { runRepositoryChecks } from "./runner";

const plan = buildRepositoryCheckPlan({
  packageManager: "pnpm@10.12.4",
  scripts: {
    typecheck: "tsc --noEmit",
    lint: "eslint .",
    build: "next build",
    test: "vitest run",
  },
  lockfiles: [],
});

it("runs every full check and records the command and exit evidence", async () => {
  const commands: string[] = [];
  const result = await runRepositoryChecks(plan, async (command) => {
    commands.push(command);
    return { exitCode: 0, stdout: "passed", stderr: "" };
  });
  expect(commands).toEqual(plan.map((check) => check.command));
  expect(result.ok).toBe(true);
  expect(
    result.checks.map((check) => [check.kind, check.status, check.exitCode])
  ).toEqual([
    ["typecheck", "passed", 0],
    ["lint", "passed", 0],
    ["build", "passed", 0],
    ["test", "passed", 0],
  ]);
});

it("continues applicable checks after a confirmed failure and never converts it to success", async () => {
  const result = await runRepositoryChecks(plan, async (command) => ({
    exitCode: command.includes("typecheck") ? 2 : 0,
  }));
  expect(result.ok).toBe(false);
  expect(result.checks.map((check) => check.status)).toEqual([
    "failed",
    "passed",
    "passed",
    "passed",
  ]);
  expect(result.checks[0].exitCode).toBe(2);
});

it.each([
  { exitCode: 0, failures: [1] },
  { exitCode: 0, outputCheck: "A shell step failed." },
  { exitCode: 0, error: "The result could not be saved." },
])("does not accept hidden shell failure evidence %j", async (output) => {
  const result = await runRepositoryChecks(plan, async () => output);
  expect(result.ok).toBe(false);
  expect(result.checks).toHaveLength(4);
  expect(result.checks.every((check) => check.status === "failed")).toBe(true);
});

it("does not launch another command when the previous one's termination is unconfirmed", async () => {
  const commands: string[] = [];
  const result = await runRepositoryChecks(plan, async (command) => {
    commands.push(command);
    return { exitCode: null, stdout: "still running" };
  });
  expect(commands).toHaveLength(1);
  expect(result.ok).toBe(false);
  expect(result.checks.every((check) => check.status === "blocked")).toBe(true);
});

it("reports missing commands and an empty plan as incomplete", async () => {
  const result = await runRepositoryChecks([], async () => {
    throw new Error("No command should run");
  });
  expect(result.ok).toBe(false);
  expect(result.checks).toHaveLength(4);
  expect(result.checks.every((check) => check.status === "not_run")).toBe(true);
});

it("honors cancellation before starting another check", async () => {
  const controller = new AbortController();
  const commands: string[] = [];
  const result = runRepositoryChecks(
    plan,
    async (command) => {
      commands.push(command);
      controller.abort(new Error("Cancelled"));
      return { exitCode: 0 };
    },
    controller.signal
  );
  await expect(result).rejects.toThrow("Cancelled");
  expect(commands).toHaveLength(1);
});

it("does not replay an execution whose observation failed", async () => {
  let attempts = 0;
  const result = await runRepositoryChecks(plan, async () => {
    attempts += 1;
    throw new Error("An internal upstream error with sensitive details");
  });
  expect(attempts).toBe(1);
  expect(result.ok).toBe(false);
  expect(result.checks.every((check) => check.status === "blocked")).toBe(true);
  expect(JSON.stringify(result)).not.toContain("sensitive details");
});

it("reports commands rejected before launch without treating them as possibly running", async () => {
  const result = await runRepositoryChecks(plan, async () => ({
    commandStarted: false,
    error: "Sandbox startup is still in progress.",
  }));
  expect(result.checks.map((row) => row.status)).toEqual([
    "not_run",
    "not_run",
    "not_run",
    "not_run",
  ]);
  expect(result.checks[0].reason).toContain("startup");
  expect(result.ok).toBe(false);
});
