import { expect, test } from "vitest";
import { deliveryPresentation } from "./presentation";
import { deliverySnapshot } from "./fixtures.test-support";
import type { RunWorkspaceContext } from "@/lib/run-workspace/types";

const context = (): RunWorkspaceContext => ({
  runId: "run",
  aiCallId: "call",
  prompt: "Task",
  status: "success",
  sandboxRecordId: null,
  workingBranch: "feature",
  canGuide: false,
  delivery: deliverySnapshot(),
  deliveryFollowThrough: true,
  repo: {
    id: "repo",
    user_id: "owner",
    full_name: "acme/widgets",
    created_at: "2026-11-17T00:00:00Z",
  },
});
test("agent success never becomes merge or deployment proof", () => {
  const c = context();
  c.delivery!.checks.state = "success";
  expect(deliveryPresentation(c)).toMatchObject({
    merge: "Not merged",
    production: "No deployment reported",
    notice: "Watching GitHub for CI and review updates.",
  });
  c.delivery!.pullRequest!.draft = true;
  expect(deliveryPresentation(c)?.pullRequest).toContain("Draft");
  c.delivery!.pullRequest!.state = "closed";
  expect(deliveryPresentation(c)?.merge).toBe("Closed without merging");
  c.delivery = null;
  expect(deliveryPresentation(c)).toBeNull();
});
test("repeated failures and required review remain visible with accurate progress", () => {
  const c = context();
  c.deliveryLastRepairRevision = c.delivery!.repairRevision;
  expect(deliveryPresentation(c)?.notice).toContain("Needs attention");
  c.status = "streaming";
  expect(deliveryPresentation(c)?.notice).toBe(
    "Agent is following up on this PR."
  );
  c.delivery!.checks.state = "success";
  c.delivery!.review.state = "required";
  expect(deliveryPresentation(c)?.checks).toBe(
    "Checks passed · Review required"
  );
  c.delivery!.review.state = "unknown";
  expect(deliveryPresentation(c)?.checks).toContain("Review not confirmed");
  c.delivery!.review.unresolved = 1;
  expect(deliveryPresentation(c)?.checks).toContain("Review needs attention");
  for (const state of [
    "pending",
    "failure",
    "inactive",
    "unavailable",
    "success",
  ] as const) {
    c.delivery!.deployment.state = state;
    expect(deliveryPresentation(c)?.production).not.toBe(
      "No deployment reported"
    );
  }
});
