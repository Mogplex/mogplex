import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createRunCheckpointPostHandler } from "../../app/api/runs/[runId]/checkpoint/route";
import { buildRunRow } from "./helpers/mogplex-api-runs-fixtures";

const runId = "00000000-0000-4000-8000-000000000901";
const aiCallId = "00000000-0000-4000-8000-000000000902";
const params = { params: Promise.resolve({ runId }) };
const request = (body: unknown) =>
  new Request("https://example.test/api/runs/checkpoint", {
    method: "POST",
    body: JSON.stringify(body),
  });
function fixture() {
  const run = buildRunRow({
    id: runId,
    ai_call_id: aiCallId,
    status: "awaiting_input",
    metadata: { checkpoint_kind: "plan" },
  });
  const queued = new Map<
    string,
    {
      steer: string;
      mode?: string;
      followThrough?: boolean;
      checkpointAiCallId?: string;
    }
  >();
  const deps = {
    requireUserId: async () => "owner",
    loadRun: async (owner: string, id: string) =>
      owner === "owner" && id === runId ? run : null,
    queueResume: async (input: {
      idempotencyKey: string;
      steer: string;
      mode?: string;
    }) => {
      if (!queued.has(input.idempotencyKey))
        queued.set(input.idempotencyKey, input);
      return { runtimeProvider: "trigger" as const, runtimeRunId: "task" };
    },
  };
  return { run, queued, deps };
}

test("approve and revise use the saved checkpoint and Slack's once-per-pass resume key", async () => {
  for (const kind of ["plan", "review"]) {
    for (const action of ["approve", "revise"]) {
      const f = fixture();
      f.run.metadata.checkpoint_kind = kind;
      const handler = createRunCheckpointPostHandler(f.deps);
      const body = { aiCallId, action, feedback: "Keep the existing colors" };
      assert.equal((await handler(request(body), params)).status, 202);
      assert.equal((await handler(request(body), params)).status, 202);
      assert.equal(f.queued.size, 1);
      const continuation = f.queued.get(
        `checkpoint-resume:${runId}:${aiCallId}`
      )!;
      assert.equal(
        continuation.followThrough === true,
        action === "approve" && kind === "review"
      );
      assert.equal(continuation.checkpointAiCallId, aiCallId);
      assert.equal(
        continuation.mode,
        action === "revise" && kind === "plan" ? "plan" : "review"
      );
      assert.equal(
        continuation.steer,
        action === "revise"
          ? body.feedback
          : kind === "plan"
            ? "The user approved your plan. Implement it now."
            : "Approved. Open the pull request and follow up on CI failures and actionable review findings within this task. Mogplex will resume you on GitHub updates; report blockers that need the user. Merge only if the user already authorized it."
      );
    }
  }
});

test("rejects unauthenticated, foreign, malformed, stale and no-longer-paused answers", async () => {
  const f = fixture();
  const body = { action: "approve", aiCallId };
  const unauthorized = createRunCheckpointPostHandler({
    ...f.deps,
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
  assert.equal((await unauthorized(request(body), params)).status, 401);
  const foreign = createRunCheckpointPostHandler({
    ...f.deps,
    requireUserId: async () => "foreign",
  });
  assert.equal((await foreign(request(body), params)).status, 404);
  const handler = createRunCheckpointPostHandler(f.deps);
  for (const invalid of [
    null,
    {},
    { action: "other", aiCallId },
    { action: "revise", aiCallId, feedback: " " },
    { ...body, aiCallId: "invalid" },
  ])
    assert.equal((await handler(request(invalid), params)).status, 400);
  assert.equal(
    (
      await handler(request(body), {
        params: Promise.resolve({ runId: "invalid" }),
      })
    ).status,
    400
  );
  assert.equal(
    (await handler(request({ ...body, aiCallId: runId }), params)).status,
    409
  );
  for (const status of [
    "streaming",
    "success",
    "failed",
    "cancelled",
  ] as const) {
    f.run.status = status;
    assert.equal((await handler(request(body), params)).status, 409);
  }
  assert.equal(f.queued.size, 0);
});

test("queue failures leave the saved plan available and keep diagnostics private", async () => {
  const f = fixture();
  const handler = createRunCheckpointPostHandler({
    ...f.deps,
    queueResume: async () => {
      throw new Error("private infrastructure error");
    },
  });
  const response = await handler(
    request({ action: "approve", aiCallId }),
    params
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Could not confirm your response. Try again.",
  });
  assert.equal(f.run.status, "awaiting_input");
});
