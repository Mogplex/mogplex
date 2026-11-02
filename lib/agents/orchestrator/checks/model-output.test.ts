import { expect, it } from "vitest";
import { CHECK_KINDS } from "./plan";
import type { RepositoryCheckReceipt } from "./receipt";
import { repositoryChecksModelOutput } from "./model-output";

const receipt = (): RepositoryCheckReceipt => ({
  ok: true,
  verified: true,
  receiptVersion: 1,
  commandCompletion: "confirmed",
  sandboxId: "workspace-1",
  workspaceRevisionBefore: "a",
  workspaceRevisionAfter: "a",
  checks: CHECK_KINDS.map((kind) => ({
    kind,
    command: `pnpm run ${kind}`,
    status: "passed",
    exitCode: 0,
    stdout: "FULL_OPERATOR_OUTPUT" + "x".repeat(8000),
  })),
});

it("keeps passing command evidence compact without changing the operator receipt", () => {
  const full = receipt();
  const compact = repositoryChecksModelOutput({ output: full });
  expect(compact.type).toBe("json");
  expect(JSON.stringify(compact)).toContain('"verified":true');
  expect(JSON.stringify(compact).includes("FULL_OPERATOR_OUTPUT")).toBe(false);
  expect(full.checks[0].stdout).toContain("FULL_OPERATOR_OUTPUT");
});

it("keeps failure status, reason, and the useful output tail", () => {
  const full = receipt();
  full.ok = false;
  full.verified = false;
  full.checks[0] = {
    ...full.checks[0],
    status: "failed",
    exitCode: 2,
    reason: "A hidden shell step failed.",
    stdout: "LONG_HEADER" + "x".repeat(8000) + "FINAL_FAILURE",
  };
  const compact = JSON.stringify(repositoryChecksModelOutput({ output: full }));
  expect(compact).toContain('"exitCode":2');
  expect(compact).toContain("A hidden shell step failed.");
  expect(compact).toContain("FINAL_FAILURE");
  expect(compact.includes("LONG_HEADER")).toBe(false);
  expect(compact.length).toBeLessThan(4000);
});

it("preserves permission guidance and never promotes malformed evidence", () => {
  const denied = repositoryChecksModelOutput({
    output: { status: "policy_denied", summary: "Plan mode blocks checks." },
  });
  expect(JSON.stringify(denied)).toContain("Plan mode blocks checks.");
  const invalid = repositoryChecksModelOutput({
    output: { verified: true, checks: [] },
  });
  expect(invalid.type).toBe("text");
  if (invalid.type === "text")
    expect(invalid.value.includes('"verified":true')).toBe(false);
});
