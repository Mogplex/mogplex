import { task } from "@trigger.dev/sdk/v3";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import { deliverSlackRunUpdate } from "@/lib/slack/run-delivery";
import type { RunDeliveryPayload } from "@/lib/slack/run-delivery-queue";

export const deliverSlackRunUpdateTask = task({
  id: TRIGGER_TASK_IDS.slackRunDelivery,
  maxDuration: 60,
  // Serialize edits to ONE Slack message, not runs or users. A late progress
  // job reloads terminal state and can never overwrite it with "Working".
  queue: { concurrencyLimit: 1 },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  run: (payload: RunDeliveryPayload) => deliverSlackRunUpdate(payload),
});
