import { schemaTask } from "@trigger.dev/sdk/v3";
import {
  controlContinuationPayload,
  executeControlContinuation,
  failControlContinuation,
} from "@/lib/control/continuation-runtime";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

export const executeControlContinuationTask = schemaTask({
  id: TRIGGER_TASK_IDS.controlContinuation,
  schema: controlContinuationPayload,
  maxDuration: 60 * 30,
  retry: { maxAttempts: 1 },
  run: (payload, { ctx, signal }) =>
    executeControlContinuation(payload, ctx.run.id, signal),
  onFailure: async ({ payload, ctx }) => {
    await failControlContinuation(payload, ctx.run.id);
  },
  onCancel: async ({ payload, ctx, runPromise }) => {
    await runPromise.catch(() => undefined);
    await failControlContinuation(payload, ctx.run.id);
  },
});
