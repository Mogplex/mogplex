import { expect, it } from "vitest";
import { CHECK_KINDS } from "./plan";
import { createRepositoryVerificationState } from "./state";
import type { RepositoryCheckReceipt } from "./tool";

const revision = (value: string) => ({
  sandboxId: "workspace-one",
  revision: value,
});
const receipt = (value: string): RepositoryCheckReceipt => ({
  ok: true,
  verified: true,
  sandboxId: "workspace-one",
  receiptVersion: 1,
  commandCompletion: "confirmed",
  workspaceRevisionBefore: value,
  workspaceRevisionAfter: value,
  checks: CHECK_KINDS.map((kind) => ({
    kind,
    command: `pnpm run ${kind}`,
    status: "passed",
    exitCode: 0,
  })),
});

it("does not start checks for an unchanged inspection-only workspace", () => {
  const state = createRepositoryVerificationState();
  state.observe(revision("original"));
  state.observe(revision("original"));
  expect(state.summary()).toMatchObject({
    changed: false,
    required: false,
    verified: false,
  });
});

it("requires an attempt after source contents change and accepts matching exit receipts", () => {
  const state = createRepositoryVerificationState();
  state.observe(revision("original"));
  state.observe(revision("edited"));
  expect(state.summary()).toMatchObject({
    changed: true,
    required: true,
    verified: false,
  });
  state.recordReceipt(receipt("edited"));
  expect(state.summary()).toMatchObject({ required: false, verified: true });
  state.observe(revision("edited"));
  expect(state.summary().verified).toBe(true);
  state.observe(revision("edited-again"));
  expect(state.summary()).toMatchObject({ required: true, verified: false });
  expect(state.summary().checks.every((row) => row.status === "not_run")).toBe(
    true
  );
});

it("does not let an earlier version or another workspace verify the current edits", () => {
  const state = createRepositoryVerificationState();
  state.observe(revision("original"));
  state.observe(revision("edited"));
  state.recordReceipt(receipt("original"));
  state.recordReceipt({ ...receipt("edited"), sandboxId: "another-workspace" });
  expect(state.summary()).toMatchObject({ required: true, verified: false });
});

it("requires another attempt if the checks themselves changed source contents", () => {
  const state = createRepositoryVerificationState();
  state.observe(revision("original"));
  state.observe(revision("edited"));
  state.recordReceipt({
    ...receipt("edited"),
    ok: false,
    workspaceRevisionAfter: "autofixed",
    error: "Source changed during checks.",
  });
  expect(state.summary()).toMatchObject({ required: true, verified: false });
  state.recordReceipt(receipt("autofixed"));
  expect(state.summary()).toMatchObject({ required: false, verified: true });
});

it("counts each full manual check once and preserves failed results honestly", () => {
  const state = createRepositoryVerificationState();
  state.observe(revision("original"));
  state.observe(revision("edited"));
  for (const row of receipt("edited").checks.slice(0, 3))
    state.recordManual(row);
  expect(state.summary().required).toBe(true);
  state.recordManual({
    ...receipt("edited").checks[3],
    status: "failed",
    exitCode: 1,
  });
  expect(state.summary()).toMatchObject({ required: false, verified: false });
  expect(state.summary().checks[3].status).toBe("failed");
  state.recordManual(receipt("edited").checks[3]);
  expect(state.summary().verified).toBe(true);
});

it("does not repeatedly force checks after losing observation of a command", () => {
  const state = createRepositoryVerificationState();
  state.observe(revision("original"));
  state.observe(revision("edited"));
  state.block("Command completion could not be confirmed.");
  expect(state.summary()).toMatchObject({
    changed: true,
    required: false,
    verified: false,
    error: "Command completion could not be confirmed.",
  });
  expect(state.summary().checks.every((row) => row.status === "blocked")).toBe(
    true
  );
});

it("records unavailable scripts explicitly without treating an attempted check as a pass", () => {
  const state = createRepositoryVerificationState();
  state.observe(revision("original"));
  state.observe(revision("edited"));
  state.recordReceipt({
    ...receipt("edited"),
    ok: false,
    checks: receipt("edited").checks.map((row) => ({
      ...row,
      command: null,
      status: "not_run",
      exitCode: null,
      reason: "No applicable script is defined.",
    })),
  });
  expect(state.summary()).toMatchObject({ required: false, verified: false });
  expect(state.summary().checks.every((row) => row.status === "not_run")).toBe(
    true
  );
});

it("can require verification before delivering existing code without rechecking verified contents", () => {
  const state = createRepositoryVerificationState();
  state.observe(revision("original"));
  state.requireChecks();
  expect(state.summary().required).toBe(true);
  state.recordReceipt(receipt("original"));
  state.requireChecks();
  expect(state.summary()).toMatchObject({ required: false, verified: true });
});

it("does not count repeating one manual command as coverage of four different checks", () => {
  const state = createRepositoryVerificationState();
  state.observe(revision("original"));
  state.requireChecks();
  for (let index = 0; index < 4; index += 1)
    state.recordManual(receipt("original").checks[0]);
  expect(state.summary()).toMatchObject({ required: true, verified: false });
});

it("does not verify a receipt whose final source revision is unknown", () => {
  const state = createRepositoryVerificationState();
  state.observe(revision("original"));
  state.requireChecks();
  state.recordReceipt({ ...receipt("original"), workspaceRevisionAfter: null });
  expect(state.summary()).toMatchObject({ required: false, verified: false });
  expect(state.summary().checks.every((row) => row.status === "blocked")).toBe(
    true
  );
});

it("does not hide an overall verification failure behind four passing rows", () => {
  const state = createRepositoryVerificationState();
  state.observe(revision("original"));
  state.recordReceipt({ ...receipt("original"), ok: false });
  expect(state.summary().verified).toBe(false);
  expect(state.summary().error).toContain("could not be confirmed");
});

it("does not verify a receipt that reports unknown command completion", () => {
  const state = createRepositoryVerificationState();
  state.observe(revision("original"));
  state.recordReceipt({ ...receipt("original"), commandCompletion: "unknown" });
  expect(state.summary().verified).toBe(false);
});
