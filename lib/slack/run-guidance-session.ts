import { convertToModelMessages, type ModelMessage } from "ai";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import { buildNativeRunMessages } from "@/lib/mogplex-api/native-run-context";
import { SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY } from "./run-attachments";
import {
  loadRunGuidance,
  deliverRunGuidance,
  recordRunGuidanceReply,
} from "./run-guidance-store";
import { queueSlackRunDelivery } from "./run-delivery-queue";
import { readSlackRunControlsMetadata } from "./run-controls";

const defaultDeps = {
  load: loadRunGuidance,
  deliver: deliverRunGuidance,
  recordReply: recordRunGuidanceReply,
  buildMessages: buildNativeRunMessages,
  queue: queueSlackRunDelivery,
};

/** Guidance enters only on an actual model-step boundary, never mid-command. */
export function createRunGuidanceSession(
  run: ExternalAgentRunRow,
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const seen = new Set<string>();
  let pending: string[] = [];
  // Delivered guidance waits for the agent's first step that says something.
  let awaitingReply: string[] = [];
  let step = 0;
  return {
    async prepare(
      messages: ModelMessage[],
      stepNumber: number
    ): Promise<ModelMessage[]> {
      step = stepNumber;
      const rows = await deps.load(run);
      const additions: ModelMessage[] = [];
      for (const row of rows) {
        if (row.status === "not_applied" || seen.has(row.id)) continue;
        const ui = await deps.buildMessages({
          ...run,
          prompt: `Additional guidance from the user for this same task:\n${row.body}`,
          metadata: {
            [SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY]: row.attachments,
          },
        });
        additions.push(...(await convertToModelMessages(ui)));
        seen.add(row.id);
        if (row.status === "received") pending.push(row.id);
      }
      // SDK 7 carries prepareStep messages into subsequent steps. Append each
      // update once; a reconstructed worker loads delivered guidance again.
      return additions.length === 0 ? messages : [...messages, ...additions];
    },
    /** `text` is what the agent wrote in the step that just ended. */
    async stepFinished(text = "") {
      const ids = [...pending];
      let changed = false;
      if (ids.length > 0) {
        const delivered = await deps.deliver({
          runId: run.id,
          userId: run.user_id,
          aiCallId: run.ai_call_id,
          ids,
          step,
        });
        pending = pending.filter((id) => !ids.includes(id));
        if (delivered > 0) {
          awaitingReply.push(...ids);
          changed = true;
        }
      }
      if (awaitingReply.length > 0 && text.trim()) {
        const replyIds = [...awaitingReply];
        awaitingReply = [];
        changed =
          (await deps.recordReply({
            runId: run.id,
            userId: run.user_id,
            aiCallId: run.ai_call_id,
            ids: replyIds,
            text: text.trim(),
          })) > 0 || changed;
      }
      // Only a Slack thread has a run card and a thread to answer in.
      if (changed && readSlackRunControlsMetadata(run.metadata)) {
        try {
          await deps.queue({ runId: run.id, userId: run.user_id });
        } catch {
          console.warn("[slack-guidance] receipt delivery pending", run.id);
        }
      }
    },
  };
}
