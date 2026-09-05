import assert from "node:assert/strict";
import test from "node:test";
import {
  loadSlackEventTask,
  baseInstallation,
  basePayload,
  mappedAttribution,
} from "./helpers/slack-event-task-fixtures";
import { buildRunRow } from "./helpers/mogplex-api-runs-fixtures";
import type { SlackEventTaskDeps } from "../../trigger/slack-event-lib/types";
import { resolveGuidanceBeforeWorkflow } from "../../trigger/slack-event-lib/guidance";

const run = buildRunRow({
  harness: "mogplex",
  user_id: "user-mogplex",
  status: "streaming",
  metadata: { slack_guidance_enabled: true },
});
function fixture(changes: Partial<SlackEventTaskDeps> = {}) {
  const posts: string[] = [];
  const submitted: unknown[] = [];
  const deps: Partial<SlackEventTaskDeps> = {
    getInstallation: async () => baseInstallation,
    getBotToken: async () => "test-token",
    resolveSlackAttribution: async () => mappedAttribution(),
    findGuidanceRuns: async (input) => {
      assert.equal(input.userId, "user-mogplex");
      assert.equal(input.threadTs, basePayload.threadTs);
      assert.equal(input.eventId, basePayload.eventId);
      return [run];
    },
    submitGuidance: async (input) => {
      submitted.push(input);
      return { id: "00000000-0000-4000-8000-000000000005", status: "received" };
    },
    postMessage: async (_token, input) => {
      posts.push(input.text);
      return { channel: input.channel, ts: "1.9" };
    },
    startRepoAgentRun: async () => {
      throw new Error("Must not launch a duplicate run");
    },
    runAgent: async () => {
      throw new Error("Must not start a conversational agent");
    },
    ...changes,
  };
  return { deps, posts, submitted };
}
const reply = {
  ...basePayload,
  messageTs: "1700000001.000200",
  text: "Keep the desktop header unchanged.",
};

test("an active-run mention is resolved before automation dispatch and keeps the event identity", async () => {
  const result = await resolveGuidanceBeforeWorkflow(
    { ...reply, eventType: "app_mention" },
    baseInstallation,
    {
      getBotToken: async () => "fixture-token",
      resolveSlackAttribution: async () => mappedAttribution(),
      findGuidanceRuns: async (thread) => {
        assert.equal(thread.eventId, reply.eventId);
        assert.equal(thread.slackUserId, reply.slackUserId);
        return [run];
      },
    }
  );
  assert.deepEqual(result?.runs, [run]);
  assert.equal(result?.attribution.mogplexUserId, run.user_id);
});

test("a completed run's webhook retry acknowledges its original receipt and never launches again", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  const f = fixture({
    findGuidanceRuns: async () => [{ ...run, status: "success" }],
    submitGuidance: async () => ({
      id: "00000000-0000-4000-8000-000000000005",
      status: "delivered",
    }),
  });
  assert.equal(
    (await runSlackEventTask(reply, f.deps)).outcome,
    "run_guidance_received"
  );
  assert.ok(f.posts.some((text) => text.includes("already supplied")));
});

test("an authenticated run-thread reply saves guidance without launching another agent", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  const f = fixture();
  const result = await runSlackEventTask(reply, f.deps);
  assert.equal(result.outcome, "run_guidance_received");
  assert.equal(f.submitted.length, 1);
  assert.ok(f.posts.some((text) => text.includes("next step")));
  assert.ok(f.posts.every((text) => !text.includes("applied your")));
});
test("completion between thread lookup and acceptance explains that the update was not delivered", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  const f = fixture({
    submitGuidance: async () => ({
      id: "00000000-0000-4000-8000-000000000005",
      status: "not_applied",
    }),
  });
  assert.equal(
    (await runSlackEventTask(reply, f.deps)).outcome,
    "run_guidance_not_applied"
  );
  assert.ok(
    f.posts.some((text) =>
      text.includes("delivery of this update could be confirmed")
    )
  );
});
test("a thread lookup failure fails closed instead of starting duplicate work", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  const f = fixture({
    findGuidanceRuns: async () => {
      throw new Error("DB unavailable");
    },
  });
  assert.equal(
    (await runSlackEventTask(reply, f.deps)).outcome,
    "run_guidance_unavailable"
  );
  assert.equal(f.submitted.length, 0);
  assert.ok(f.posts.some((text) => text.includes("no new run was started")));
});
test("paused, legacy and ambiguous runs do not falsely accept live guidance", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  for (const rows of [
    [{ ...run, status: "awaiting_input" as const }],
    [{ ...run, metadata: {} }],
    [run, { ...run, id: "run-2" }],
  ]) {
    const f = fixture({ findGuidanceRuns: async () => rows });
    assert.equal(
      (await runSlackEventTask(reply, f.deps)).outcome,
      "run_guidance_unavailable"
    );
    assert.equal(f.submitted.length, 0);
  }
});
test("workspace restrictions still apply to a run owner sending guidance", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  const f = fixture({
    getInstallation: async () => ({
      ...baseInstallation,
      allowed_slack_user_ids: ["OTHER"],
    }),
  });
  assert.equal(
    (await runSlackEventTask(reply, f.deps)).outcome,
    "repo_agent_user_not_allowed"
  );
  assert.equal(f.submitted.length, 0);
});
test("image-only replies retain their attachment context", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  const f = fixture();
  await runSlackEventTask(
    {
      ...reply,
      text: "",
      attachments: [
        {
          id: "F1",
          mimetype: "image/png",
          urlPrivateDownload:
            "https://files.slack.com/files-pri/T1-F1/image.png",
        },
      ],
    },
    f.deps
  );
  assert.equal(f.submitted.length, 1);
  assert.equal(
    (f.submitted[0] as { attachments: { teamId: string; files: unknown[] } })
      .attachments.teamId,
    "T1"
  );
  assert.equal(
    (f.submitted[0] as { attachments: { files: unknown[] } }).attachments.files
      .length,
    1
  );
});
