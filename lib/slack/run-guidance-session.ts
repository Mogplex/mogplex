import { convertToModelMessages, type ModelMessage } from "ai";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import { buildNativeRunMessages } from "@/lib/mogplex-api/native-run-context";
import { SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY } from "./run-attachments";
import { loadRunGuidance, deliverRunGuidance } from "./run-guidance-store";
import { queueSlackRunDelivery } from "./run-delivery-queue";

const defaultDeps = {
  load: loadRunGuidance,
  deliver: deliverRunGuidance,
  buildMessages: buildNativeRunMessages,
  queue: queueSlackRunDelivery,
};

/** Guidance enters only on an actual model-step boundary, never mid-command. */
export function createRunGuidanceSession(
  run: ExternalAgentRunRow,
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const insertions: Array<{
    at: number;
    id: string;
    messages: ModelMessage[];
  }> = [];
  const seen = new Set<string>();
  let pending: string[] = [];
  let step = 0;
  return {
    async prepare(
      messages: ModelMessage[],
      stepNumber: number
    ): Promise<ModelMessage[]> {
      step = stepNumber;
      const rows = await deps.load(run);
      for (const row of rows) {
        if (row.status === "not_applied" || seen.has(row.id)) continue;
        const ui = await deps.buildMessages({
          ...run,
          prompt: `Additional guidance from the user for this same task:\n${row.body}`,
          metadata: {
            [SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY]: row.attachments,
          },
        });
        insertions.push({
          at: messages.length,
          id: row.id,
          messages: await convertToModelMessages(ui),
        });
        seen.add(row.id);
        if (row.status === "received") pending.push(row.id);
      }
      if (insertions.length === 0) return messages;
      // prepareStep overrides are not retained by the SDK. Reinsert each user
      // update at its original transcript boundary on later steps, exactly once.
      const augmented: ModelMessage[] = [];
      for (let index = 0; index <= messages.length; index++) {
        for (const insertion of insertions)
          if (insertion.at === index) augmented.push(...insertion.messages);
        if (index < messages.length) augmented.push(messages[index]);
      }
      return augmented;
    },
    async stepFinished() {
      const ids = [...pending];
      if (ids.length === 0) return;
      const delivered = await deps.deliver({
        runId: run.id,
        userId: run.user_id,
        aiCallId: run.ai_call_id,
        ids,
        step,
      });
      pending = pending.filter((id) => !ids.includes(id));
      if (delivered > 0) {
        try {
          await deps.queue({ runId: run.id, userId: run.user_id });
        } catch {
          console.warn("[slack-guidance] receipt delivery pending", run.id);
        }
      }
    },
  };
}
