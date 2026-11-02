import assert from "node:assert/strict";
import test from "node:test";
import { verificationMessageMetadata } from "../../app/api/control/chat/_lib/verification-metadata";
import type { RepositoryVerificationSummary } from "../../lib/agents/orchestrator/checks/receipt";
import { CHECK_KINDS } from "../../lib/agents/orchestrator/checks/plan";

test("check metadata sends changed evidence once and still invalidates it on Stop", () => {
  let evidence: RepositoryVerificationSummary = {
    version: 1,
    changed: true,
    required: false,
    verified: true,
    error: null,
    checks: CHECK_KINDS.map((kind) => ({
      kind,
      command: `pnpm run ${kind}`,
      status: "passed",
      exitCode: 0,
      stdout: "Full operator evidence",
    })),
  };
  const metadata = verificationMessageMetadata({
    call: { id: "call-1", metadata: {} },
    model: "test/model",
    verification: {
      metadata: () => evidence,
      interrupt() {
        evidence = { ...evidence, verified: false, error: "Interrupted" };
      },
    },
  });
  assert.deepEqual(
    metadata({ part: { type: "finish-step" } })?.repository_verification,
    evidence
  );
  assert.equal(
    metadata({ part: { type: "finish-step" } })?.repository_verification,
    undefined
  );
  assert.equal(
    metadata({ part: { type: "abort" } })?.repository_verification?.verified,
    false
  );
});
