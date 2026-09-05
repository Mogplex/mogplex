import { readSlackRunControlsMetadata } from "./run-controls";
import { setTimeout as delay } from "node:timers/promises";
import type { HarnessProgressUpdate } from "@/lib/mogplex-api/harness-progress";
import type { UpdateSlackMessageInput } from "./client";
import {
  applyRunProgress,
  createRunProgressState,
  finishProgressText,
} from "./run-progress-state";
import {
  buildRunProgressMessage,
  type ProgressRun,
} from "./run-progress-presentation";

type SlackRunProgressImpl = {
  getSlackBotToken: (teamId: string) => Promise<string | null>;
  updateSlackMessage: (
    botToken: string,
    input: UpdateSlackMessageInput
  ) => Promise<unknown>;
};
export type SlackRunProgressDeps = Partial<SlackRunProgressImpl> & {
  now?: () => number;
  /** Existing Slack edit pacing; semantic tool/phase boundaries flush explicitly. */
  minUpdateIntervalMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
};
export type SlackRunProgressReporter = {
  report: (update: HarnessProgressUpdate) => Promise<void>;
  flush: () => Promise<void>;
};
const NOOP_REPORTER: SlackRunProgressReporter = {
  report: async () => {},
  flush: async () => {},
};

/** One ordered writer. Failed deliveries stay dirty; no timer or status polling. */
export function createSlackRunProgressReporter(
  run: ProgressRun,
  deps: SlackRunProgressDeps = {}
): SlackRunProgressReporter {
  const slack = readSlackRunControlsMetadata(run.metadata);
  if (!slack) return NOOP_REPORTER;
  const { teamId, channelId, messageTs } = slack;
  const now = deps.now ?? Date.now;
  const state = createRunProgressState(now());
  let revision = 0;
  let sentRevision = 0;
  let lastUpdateAt = -Infinity;
  let pending = Promise.resolve();
  let botToken: string | undefined;
  const minInterval = deps.minUpdateIntervalMs ?? 2500;
  const wait = deps.wait ?? delay;
  function enqueueFlush() {
    pending = pending.then(async () => {
      if (sentRevision === revision) return;
      const sendingRevision = revision;
      try {
        if (!deps.getSlackBotToken && !deps.updateSlackMessage) {
          if (!run.user_id || !run.ai_call_id)
            throw new Error("Missing run identity");
          const { publishRunProgress } = await import("./run-progress-store");
          const { queueSlackRunDelivery } =
            await import("./run-delivery-queue");
          const saved = await publishRunProgress({
            runId: run.id,
            userId: run.user_id,
            aiCallId: run.ai_call_id,
            state,
          });
          if (saved !== null)
            await queueSlackRunDelivery({ runId: run.id, userId: run.user_id });
          sentRevision = sendingRevision;
          lastUpdateAt = now();
          return;
        }
        // Only direct transports wait here. Production saves/queues immediately;
        // the delivery worker owns Slack pacing without delaying the coding agent.
        const remaining = minInterval - (now() - lastUpdateAt);
        if (remaining > 0) await wait(remaining);
        const impl =
          deps.getSlackBotToken && deps.updateSlackMessage
            ? {
                getSlackBotToken: deps.getSlackBotToken,
                updateSlackMessage: deps.updateSlackMessage,
              }
            : await import("./client");
        const token = botToken ?? (await impl.getSlackBotToken(teamId));
        if (!token) return;
        botToken = token;
        const message = buildRunProgressMessage(run, state);
        await impl.updateSlackMessage(token, {
          channel: channelId,
          ts: messageTs,
          ...message,
        });
        sentRevision = sendingRevision;
        lastUpdateAt = now();
      } catch {
        console.warn("[slack-run-progress] update failed", run.id);
      }
    });
    return pending;
  }
  return {
    async report(update) {
      if (applyRunProgress(state, update, now())) revision += 1;
      await enqueueFlush();
    },
    async flush() {
      if (finishProgressText(state)) revision += 1;
      await enqueueFlush();
    },
  };
}
