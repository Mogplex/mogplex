import { expect, it } from "vitest";
import type { UIMessage } from "ai";
import { controlContinuationDatabase } from "../support/control-continuation-database";
import {
  assertControlContinuationCurrent,
  claimControlContinuation,
  controlContinuationContextSchema,
  loadControlContinuation,
  refreshControlContinuation,
  registerControlContinuation,
  updateClaimedControlContinuation,
  recordControlContinuationFailure,
} from "@/lib/control/continuation-store";
import {
  dispatchControlContinuation,
  notifyControlWorkerCompletion,
} from "@/lib/control/continuation-dispatch";

it("dispatches a durable worker handoff once through real SQL and retains delivery errors", async () => {
  const f = await controlContinuationDatabase("neon");
  const client = f.client as unknown as NonNullable<
    Parameters<typeof registerControlContinuation>[1]
  >;
  try {
    const registration = await registerControlContinuation(
      {
        userId: f.owner,
        sessionId: f.sessionId,
        parentAiCallId: f.parentCallId,
        originMessageId: "origin",
        workerRunIds: f.workerIds,
        context: controlContinuationContextSchema.parse(f.context),
        instruction: f.registerArgs.p_instruction,
      },
      client
    );
    if (registration.status !== "waiting" || !registration.continuation)
      throw new Error("Expected waiting handoff");
    const id = registration.continuation.id;
    const raw = await f.db.query<{ created_at: Date; updated_at: Date }>(
      "select created_at, updated_at from control_continuations where id=$1",
      [id]
    );
    expect(raw.rows[0].created_at).toBeInstanceOf(Date);
    expect(raw.rows[0].updated_at).toBeInstanceOf(Date);
    let executions = 0;
    const runtimeId = "coordinator-runtime";
    const trigger = async () => {
      const claimed = await claimControlContinuation(
        f.owner,
        id,
        runtimeId,
        client
      );
      if (claimed) executions++;
      return {
        id: runtimeId,
        publicAccessToken: "unused-test-token",
        taskIdentifier: "execute-control-continuation",
      };
    };
    const deps = { client, trigger };
    await notifyControlWorkerCompletion(f.owner, f.workerIds[0], deps);
    expect(executions).toBe(0);
    await f.db.query(
      "update external_agent_runs set status='failed' where id=any($1)",
      [f.workerIds]
    );
    await notifyControlWorkerCompletion(f.owner, f.workerIds[0], deps);
    expect(executions).toBe(0);
    await f.checkpointParent();
    await refreshControlContinuation(
      {
        userId: f.owner,
        id,
        parentAiCallId: f.parentCallId,
        parentMessage: f.parentMessage as UIMessage,
      },
      client
    );
    await expect(
      dispatchControlContinuation(f.owner, id, {
        client,
        trigger: async () => {
          throw new Error("Provider unavailable");
        },
      })
    ).rejects.toThrow("Could not queue");
    expect(await loadControlContinuation(f.owner, id, client)).toMatchObject({
      status: "ready",
      error: expect.stringContaining("could not be queued"),
    });
    await dispatchControlContinuation(f.owner, id, {
      client,
      trigger: async () => ({ id: runtimeId }),
    });
    expect(await loadControlContinuation(f.owner, id, client)).toMatchObject({
      status: "ready",
      runtime_run_id: runtimeId,
      error: null,
    });
    expect(executions).toBe(0);
    await Promise.all([
      notifyControlWorkerCompletion(f.owner, f.workerIds[0], deps),
      notifyControlWorkerCompletion(f.owner, f.workerIds[1], deps),
    ]);
    expect(executions).toBe(1);
    await expect(
      assertControlContinuationCurrent(f.owner, id, runtimeId, client)
    ).resolves.toBeUndefined();
    await expect(
      assertControlContinuationCurrent(f.owner, id, "other-runtime", client)
    ).rejects.toThrow("superseded");
    await updateClaimedControlContinuation(
      {
        userId: f.owner,
        id,
        runtimeRunId: runtimeId,
        status: "finished",
        error: null,
      },
      client
    );
    expect(await loadControlContinuation(f.owner, id, client)).toMatchObject({
      status: "finished",
      error: null,
    });
    await expect(
      assertControlContinuationCurrent(f.owner, id, runtimeId, client)
    ).rejects.toThrow("superseded");
    await notifyControlWorkerCompletion(f.owner, f.workerIds[0], deps);
    expect(executions).toBe(1);
  } finally {
    await f.db.close();
  }
});

it("records provider failure before execution claim without overwriting a different execution or terminal state", async () => {
  const f = await controlContinuationDatabase("neon");
  const client = f.client as unknown as Parameters<
    typeof recordControlContinuationFailure
  >[1];
  try {
    const result = await f.rpc<{ continuation: { id: string } }>(
      "control_register_continuation",
      f.registerArgs
    );
    const id = result.continuation.id;
    const fail = (runtimeRunId: string) =>
      recordControlContinuationFailure(
        { userId: f.owner, id, runtimeRunId },
        client
      );
    await fail("runtime");
    expect((await loadControlContinuation(f.owner, id, client))?.status).toBe(
      "waiting"
    );
    await f.db.query(
      "update control_continuations set status='ready' where id=$1",
      [id]
    );
    await fail("runtime");
    expect(await loadControlContinuation(f.owner, id, client)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("not replayed"),
    });
    await f.db.query(
      "update control_continuations set status='running',runtime_run_id='winner' where id=$1",
      [id]
    );
    await fail("loser");
    expect((await loadControlContinuation(f.owner, id, client))?.status).toBe(
      "running"
    );
    await fail("winner");
    expect((await loadControlContinuation(f.owner, id, client))?.status).toBe(
      "failed"
    );
    await f.db.query(
      "update control_continuations set status='cancelled' where id=$1",
      [id]
    );
    await fail("winner");
    expect((await loadControlContinuation(f.owner, id, client))?.status).toBe(
      "cancelled"
    );
  } finally {
    await f.db.close();
  }
});
