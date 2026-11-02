import { expect, it } from "vitest";
import { CHECK_KINDS } from "./plan";
import {
  repositoryCheckReceiptSchema,
  repositoryVerificationSummarySchema,
} from "./receipt";

const good = {
  ok: true,
  verified: true,
  receiptVersion: 1,
  commandCompletion: "confirmed",
  sandboxId: "workspace-1",
  workspaceRevisionBefore: "before",
  workspaceRevisionAfter: "before",
  checks: CHECK_KINDS.map((kind) => ({
    kind,
    command: `pnpm run ${kind}`,
    status: "passed",
    exitCode: 0,
  })),
};

it("accepts a complete receipt and its display summary", () => {
  expect(repositoryCheckReceiptSchema.safeParse(good).success).toBe(true);
  expect(
    repositoryVerificationSummarySchema.safeParse({
      version: 1,
      changed: true,
      required: false,
      verified: true,
      error: null,
      checks: good.checks,
    }).success
  ).toBe(true);
});

it.each([
  ["version", { receiptVersion: 2 }],
  ["missing kind", { checks: good.checks.slice(0, 3) }],
  ["duplicate kinds", { checks: good.checks.map(() => good.checks[0]) }],
  [
    "unknown kind",
    {
      checks: [{ ...good.checks[0], kind: "pretend" }, ...good.checks.slice(1)],
    },
  ],
  [
    "fractional exit",
    { checks: [{ ...good.checks[0], exitCode: 0.5 }, ...good.checks.slice(1)] },
  ],
  [
    "string exit",
    { checks: [{ ...good.checks[0], exitCode: "0" }, ...good.checks.slice(1)] },
  ],
  ["unknown completion", { commandCompletion: "pretend" }],
  [
    "unknown status",
    {
      checks: [
        { ...good.checks[0], status: "pretend" },
        ...good.checks.slice(1),
      ],
    },
  ],
])("rejects malformed receipt: %s", (_name, patch) => {
  expect(
    repositoryCheckReceiptSchema.safeParse({ ...good, ...patch }).success
  ).toBe(false);
});

it.each([
  { version: 2, checks: good.checks },
  { version: 1, checks: good.checks.map(() => good.checks[0]) },
])("rejects malformed display evidence %j", (input) => {
  expect(
    repositoryVerificationSummarySchema.safeParse({
      changed: true,
      required: false,
      verified: true,
      error: null,
      ...input,
    }).success
  ).toBe(false);
});
