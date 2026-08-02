import { logger, metadata, task } from "@trigger.dev/sdk/v3";
import {
  runSandboxAutoPauseCheck,
  type SandboxAutoPausePayload,
  type SandboxAutoPauseResult,
} from "@/lib/sandbox/auto-pause";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

type SandboxAutoPauseTaskDeps = {
  runSandboxAutoPauseCheck: typeof runSandboxAutoPauseCheck;
  metadata: Pick<typeof metadata, "set">;
  logger: Pick<typeof logger, "log">;
};

const defaultDeps: SandboxAutoPauseTaskDeps = {
  runSandboxAutoPauseCheck,
  metadata,
  logger,
};

export async function runSandboxAutoPauseTask(
  payload: SandboxAutoPausePayload,
  overrides: Partial<SandboxAutoPauseTaskDeps> = {}
): Promise<SandboxAutoPauseResult> {
  const deps: SandboxAutoPauseTaskDeps = {
    ...defaultDeps,
    ...overrides,
  };

  const result = await deps.runSandboxAutoPauseCheck(payload);

  deps.metadata.set("sandboxRecordId", payload.sandboxRecordId);
  deps.metadata.set("decisionCode", result.decisionCode);
  deps.metadata.set("paused", result.paused);
  deps.logger.log(result.message, {
    sandboxRecordId: payload.sandboxRecordId,
    sandboxId: payload.sandboxId,
    decisionCode: result.decisionCode,
    paused: result.paused,
  });

  return result;
}

export const sandboxAutoPauseTask = task({
  id: TRIGGER_TASK_IDS.sandboxAutoPause,
  maxDuration: 120,
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: SandboxAutoPausePayload) =>
    runSandboxAutoPauseTask(payload),
});
