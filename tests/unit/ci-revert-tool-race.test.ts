import assert from "node:assert/strict";
import test from "node:test";
import { buildCITools } from "../../lib/agents/ci-tools";
import {
  mockFetch,
  raceMockHandlers,
  RACE_REVERT,
  type ToolLike,
} from "./helpers/ci-revert-tool-fixtures";

test("createRevertPr reuses the winner's PR instead of deleting the shared ref after losing a PR race", async () => {
  // Delivery B repointed the ref and opened PR #95 between this call's ref
  // creation and its PR POST. The 422 on the PR POST must resolve to reuse,
  // never to a DELETE that would orphan #95's head branch.
  const { handler, events } = raceMockHandlers({
    lookupResponses: [
      [],
      [
        {
          number: 95,
          html_url: "https://github.com/pr/95",
          base: { ref: "main" },
        },
      ],
    ],
    refCreateStatus: 201,
    prCreateStatus: 422,
  });
  const mocked = mockFetch(handler);
  try {
    const result = await (
      (buildCITools(RACE_REVERT) as Record<string, unknown>)
        .createRevertPr as ToolLike
    ).execute({ reason: "r" });
    assert.deepEqual(result, {
      success: true,
      pr_number: 95,
      url: "https://github.com/pr/95",
      reused: true,
    });
    assert.deepEqual(events, []);
  } finally {
    mocked.restore();
  }
});

test("createRevertPr skips cleanup when the ref no longer points at this call's commit", async () => {
  // PR creation failed and no PR is visible yet, but the ref was repointed by
  // a concurrent delivery (different SHA). This call no longer owns it, so it
  // must not delete it.
  const { handler, events } = raceMockHandlers({
    lookupResponses: [[], []],
    refCreateStatus: 201,
    prCreateStatus: 502,
    revertBranchRefSha: "someone-elses-commit",
  });
  const mocked = mockFetch(handler);
  try {
    const result = (await (
      (buildCITools(RACE_REVERT) as Record<string, unknown>)
        .createRevertPr as ToolLike
    ).execute({ reason: "r" })) as { success: boolean };
    assert.equal(result.success, false);
    assert.deepEqual(events, []);
  } finally {
    mocked.restore();
  }
});

test("createRevertPr reuses a PR discovered on the ref-collision path instead of repointing", async () => {
  // The ref already exists and, by the time this call re-checks, its PR is
  // open - a concurrent delivery finished first. Repointing would hijack that
  // PR's head; the call must reuse it.
  const { handler, events } = raceMockHandlers({
    lookupResponses: [
      [],
      [
        {
          number: 96,
          html_url: "https://github.com/pr/96",
          base: { ref: "main" },
        },
      ],
    ],
    refCreateStatus: 422,
    prCreateStatus: 201,
  });
  const mocked = mockFetch(handler);
  try {
    const result = await (
      (buildCITools(RACE_REVERT) as Record<string, unknown>)
        .createRevertPr as ToolLike
    ).execute({ reason: "r" });
    assert.deepEqual(result, {
      success: true,
      pr_number: 96,
      url: "https://github.com/pr/96",
      reused: true,
    });
    assert.deepEqual(events, []);
  } finally {
    mocked.restore();
  }
});

test("createRevertPr reports an invalid ref name instead of patching a missing branch", async () => {
  // GitHub also returns 422 when it rejects the ref name itself. With no
  // existing branch to reuse or repoint, the call must surface the creation
  // failure rather than attempt a PATCH that can only 404.
  const { handler, events } = raceMockHandlers({
    lookupResponses: [[], []],
    refCreateStatus: 422,
    prCreateStatus: 201,
    revertBranchRefStatus: 404,
  });
  const mocked = mockFetch(handler);
  try {
    const result = (await (
      (buildCITools(RACE_REVERT) as Record<string, unknown>)
        .createRevertPr as ToolLike
    ).execute({ reason: "r" })) as { success: boolean; error?: string };
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("rejected as invalid"));
    assert.deepEqual(events, []);
  } finally {
    mocked.restore();
  }
});
