import { AbortTaskRunError, schemaTask, tasks } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import {
  controlContinuationPayload,
  executeControlContinuation,
  failControlContinuation,
} from "@/lib/control/continuation-runtime";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import {
  reconcileControlContinuationWorker,
  superviseControlContinuation,
} from "@/lib/control/continuation-supervisor";

export const executeControlContinuationWorkerTask = schemaTask({
  id: TRIGGER_TASK_IDS.controlContinuationWorker,
  schema: controlContinuationPayload.extend({
    supervisorRunId: z.string().min(1),
  }),
  maxDuration: 60 * 30,
  retry: { maxAttempts: 1 },
  run: (payload, { signal }) =>
    executeControlContinuation(payload, payload.supervisorRunId, signal),
  onCancel: async ({ payload, runPromise }) => {
    await runPromise.catch(() => undefined);
    await failControlContinuation(payload, payload.supervisorRunId);
  },
});

export const executeControlContinuationTask = schemaTask({
  id: TRIGGER_TASK_IDS.controlContinuation,
  schema: controlContinuationPayload,
  maxDuration: 60 * 30,
  retry: { maxAttempts: 3 },
  run: async (payload, { ctx }) => {
    const result = await superviseControlContinuation(payload, ctx.run.id, {
      waitForWorker: (input, idempotencyKey) =>
        tasks.triggerAndWait<typeof executeControlContinuationWorkerTask>(
          TRIGGER_TASK_IDS.controlContinuationWorker,
          input,
          { idempotencyKey, maxAttempts: 1 }
        ),
    });
    if (result.status === "failed")
      throw new AbortTaskRunError(
        "Coordinator stopped; saved output was preserved."
      );
    return result;
  },
  onFailure: async ({ payload, ctx }) => {
    await reconcileControlContinuationWorker(payload, ctx.run.id);
  },
  onCancel: async ({ payload, ctx, runPromise }) => {
    // Fence and interrupt the child through live notifications before joining it.
    await failControlContinuation(payload, ctx.run.id);
    await runPromise.catch(() => undefined);
    await reconcileControlContinuationWorker(payload, ctx.run.id);
  },
});
