import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { buildCombinedTimeline } from "../../components/control/build-combined-timeline";
import { CHECK_KINDS } from "../../lib/agents/orchestrator/checks/plan";
import type { RepositoryVerificationSummary } from "../../lib/agents/orchestrator/checks/receipt";

const summary = (): RepositoryVerificationSummary => ({
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
  })),
});
const message = (metadata: unknown): UIMessage => ({
  id: "a1",
  role: "assistant",
  parts: [{ type: "text", text: "Updated the file." }],
  metadata: { repository_verification: metadata },
});

test("the transcript shows all four actual workspace check results", () => {
  const events = buildCombinedTimeline([], [message(summary())]);
  const card = events.find((event) => event.kind === "verification");
  assert.ok(card?.kind === "verification");
  assert.equal(card.body, "Workspace checks passed");
  assert.deepEqual(
    card.verification.checks.map((row) => row.kind),
    CHECK_KINDS
  );
  assert.ok(events.some((event) => event.body === "Updated the file."));
  const updated = buildCombinedTimeline(
    [],
    [
      message(summary()),
      {
        id: "u2",
        role: "user",
        parts: [{ type: "text", text: "Keep the scope focused." }],
      },
    ]
  );
  assert.equal(
    updated.find((event) => event.kind === "verification")?.id,
    card.id
  );
});

test("partial or unavailable results never inherit a green all-passed headline", () => {
  const evidence = summary();
  evidence.checks[1] = {
    ...evidence.checks[1],
    status: "failed",
    exitCode: 1,
    stderr: "Lint failed",
  };
  const card = buildCombinedTimeline([], [message(evidence)]).find(
    (event) => event.kind === "verification"
  );
  assert.ok(card?.kind === "verification");
  assert.equal(card.verification.verified, false);
  assert.equal(card.body, "Workspace checks need attention");
});

test("explicitly omitted checks remain visible as skipped", () => {
  const evidence = summary();
  evidence.verified = false;
  evidence.checks[3] = {
    kind: "test",
    command: null,
    status: "skipped",
    exitCode: null,
    reason: "The operator requested no tests.",
  };
  const card = buildCombinedTimeline([], [message(evidence)]).find(
    (event) => event.kind === "verification"
  );
  assert.equal(card?.body, "Workspace checks limited by request");
});

test("missing or malformed evidence does not invent a verification card", () => {
  for (const evidence of [
    undefined,
    { ...summary(), checks: [] },
    {
      ...summary(),
      checks: Array.from({ length: 4 }).fill(summary().checks[0]),
    },
  ])
    assert.equal(
      buildCombinedTimeline([], [message(evidence)]).some(
        (event) => event.kind === "verification"
      ),
      false
    );
});

test("check details preserve stack frames and source literals while redacting credentials", () => {
  const evidence = summary();
  const secret = ["sk", "proj", "a".repeat(40)].join("-");
  const output =
    "expected /api/health/200\n    at check (/vercel/sandbox/src/index.ts:12:2)";
  evidence.checks[3] = {
    ...evidence.checks[3],
    status: "failed",
    exitCode: 1,
    stdout: output,
    stderr: `Authorization: Bearer ${secret}`,
    reason: "expected /api/health/200",
  };
  const card = buildCombinedTimeline([], [message(evidence)]).find(
    (event) => event.kind === "verification"
  );
  assert.ok(card?.kind === "verification");
  assert.equal(card.verification.checks[3].stdout, output);
  assert.equal(card.verification.checks[3].reason, "expected /api/health/200");
  assert.ok(!card.verification.checks[3].stderr?.includes(secret));
});
