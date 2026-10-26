import { tasks } from "@trigger.dev/sdk/v3";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import { readSlackRunControlsMetadata } from "./run-controls";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";

export type RunDeliveryPayload = { runId: string; userId: string };

export async function queueSlackRunDelivery(
  input: RunDeliveryPayload,
  trigger = tasks.trigger
) {
  // Collapse progress bursts before they reach the per-run single writer.
  // Bound the debounce so continuous activity still gets fresh Slack updates.
  // The worker reads durable state, including terminal changes and guidance.
  await trigger(TRIGGER_TASK_IDS.slackRunDelivery, input, {
    concurrencyKey: `slack-run-delivery:${input.runId}`,
    debounce: {
      key: `slack-run-delivery:${input.runId}`,
      delay: "1s",
      maxDelay: "3s",
    },
    tags: [`external-run:${input.runId}`, `user:${input.userId}`],
  });
}

/** A queued delivery is not yet delivered. Only the writer records the marker. */
export async function queueTerminalSlackRun(run: ExternalAgentRunRow) {
  if (readSlackRunControlsMetadata(run.metadata))
    await queueSlackRunDelivery({ runId: run.id, userId: run.user_id });
  return false;
}
