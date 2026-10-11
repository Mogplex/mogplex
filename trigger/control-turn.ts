import { schemaTask, tasks } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import { AGENT_WORKER_TASK_OPTIONS } from "@/lib/trigger/agent-worker-duration";
import {
  controlTurnPayload,
  reconcileControlTurn,
  superviseControlTurn,
} from "@/lib/control/turn-supervisor";
import { executeControlTurn } from "@/lib/control/turn-runtime";

export const controlTurnWorker = schemaTask({
  id: TRIGGER_TASK_IDS.controlTurnWorker,
  schema: controlTurnPayload.extend({ supervisorRunId: z.string().min(1) }),
  ...AGENT_WORKER_TASK_OPTIONS,
  run: (payload, { signal }) =>
    executeControlTurn(payload, payload.supervisorRunId, signal),
});

export const controlTurn = schemaTask({
  id: TRIGGER_TASK_IDS.controlTurn,
  schema: controlTurnPayload,
  maxDuration: 60 * 30,
  retry: { maxAttempts: 3 },
  run: (payload, { ctx }) =>
    superviseControlTurn(payload, ctx.run.id, (input, idempotencyKey) =>
      tasks.triggerAndWait<typeof controlTurnWorker>(
        TRIGGER_TASK_IDS.controlTurnWorker,
        input,
        { idempotencyKey, maxAttempts: 1 }
      )
    ),
  onFailure: async ({ payload, ctx }) => {
    await reconcileControlTurn(payload, ctx.run.id);
  },
  onCancel: async ({ payload, ctx }) => {
    await reconcileControlTurn(payload, ctx.run.id);
  },
});
