import assert from "node:assert/strict";
import test, { after } from "node:test";
import { buildSlackThreadConcurrencyKey } from "../../app/api/webhooks/slack/_lib/event-types";
import { buildRunRow } from "./helpers/mogplex-api-runs-fixtures";
import { presentMogplexApiRun } from "../../lib/mogplex-api/runs";
import {
  basePayload,
  baseInstallation,
  mappedAttribution,
  loadSlackEventTask,
  restoreFetch,
} from "./helpers/slack-event-task-fixtures";

after(restoreFetch);
for (const hasRun of [false, true])
  for (const channelType of ["im", "channel", "mpim"] as const)
    test(`${channelType} thread cancellation handles ${hasRun ? "the current run" : "an empty thread"} before guidance or the agent`, async () => {
      const { runSlackEventTask } = await loadSlackEventTask();
      let selected = false;
      let posted = false;
      let cancelled = false;
      const runId = "00000000-0000-4000-8000-000000000001";
      const result = await runSlackEventTask(
        {
          ...basePayload,
          channelType,
          text: "mogplex-cancel",
          messageTs: "1700000099.000100",
        },
        {
          getInstallation: async () => baseInstallation,
          loadBoundConversation: async () => null,
          getBotToken: async () => "fixture",
          resolveSlackAttribution: async () => mappedAttribution(),
          cancelCommand: {
            listCancelableRuns: async (scope) => {
              assert.deepEqual(scope, {
                userId: "user-mogplex",
                teamId: basePayload.teamId,
                channelId: basePayload.channelId,
                slackUserId: basePayload.slackUserId,
                threadTs: basePayload.threadTs,
              });
              selected = true;
              return hasRun ? [{ id: runId, status: "streaming" }] : [];
            },
            cancelRun: async (input) => {
              assert.equal(hasRun, true);
              assert.deepEqual(input, { userId: "user-mogplex", runId });
              cancelled = true;
              return {
                status: "cancelled",
                alreadyTerminal: false,
                run: presentMogplexApiRun(
                  buildRunRow({ id: runId, status: "cancelled" })
                ),
              };
            },
          },
          findGuidanceRuns: async () => {
            throw new Error("must not submit guidance");
          },
          runAgent: async () => {
            throw new Error("must not invoke model");
          },
          postMessage: async (_token, input) => {
            assert.equal(input.thread_ts, basePayload.threadTs);
            assert.match(
              input.text,
              hasRun
                ? /Cancellation requested/
                : /no active Mogplex runs in this thread/
            );
            posted = true;
            return { channel: basePayload.channelId, ts: "reply" };
          },
        }
      );
      assert.equal(result.outcome, "run_cancel_handled");
      assert.equal(selected && posted, true);
      assert.equal(cancelled, hasRun);
    });

test("cancellation bypasses the conversation queue but remains scoped to its thread", () => {
  const payload = { ...basePayload, messageTs: "2.1", text: "mogplex-cancel" };
  assert.equal(
    buildSlackThreadConcurrencyKey(payload),
    `slack-thread-control:T1:C1:${basePayload.threadTs}`
  );
  assert.notEqual(
    buildSlackThreadConcurrencyKey(payload),
    buildSlackThreadConcurrencyKey({ ...payload, text: "follow up" })
  );
});
