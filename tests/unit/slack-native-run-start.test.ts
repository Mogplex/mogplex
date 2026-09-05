import assert from "node:assert/strict";
import test from "node:test";
import { defaultStartRepoAgentRun } from "../../trigger/slack-event-lib/run-start";
import { startMogplexApiRun } from "../../lib/mogplex-api/runs";
import {
  buildRunRow,
  buildStartDeps,
} from "./helpers/mogplex-api-runs-fixtures";

test("Slack message and image create a native Mogplex run", async () => {
  let stored = buildRunRow();
  const image = {
    id: "F1",
    mimetype: "image/png" as const,
    urlPrivateDownload: "https://files.slack.com/files-pri/T1-F1/image.png",
  };
  const result = await defaultStartRepoAgentRun(
    {
      mogplexUserId: stored.user_id,
      repoId: stored.repo_id,
      prompt: "Fix the mobile header",
      idempotencyKey: "slack:message:1",
      slackAttachments: [image],
      slackContext: {
        teamId: "T1",
        installationId: "installation-1",
        mode: "repo_agent",
        channelId: "D1",
        slackEmail: null,
        slackUserId: "U1",
        attributionMode: "mapped_profile",
      },
    },
    (input) =>
      startMogplexApiRun({
        ...input,
        deps: buildStartDeps({
          insertRun: async (insert) => {
            stored = buildRunRow({
              harness: insert.normalized.harness,
              metadata: insert.metadata,
            });
            return stored;
          },
          markRunQueued: async () => stored,
        }),
      })
  );
  assert.equal(result.runId, stored.id);
  assert.equal(stored.harness, "mogplex");
  assert.equal(stored.metadata.harness_id, "mogplex");
  assert.deepEqual(stored.metadata.slack_image_attachments, {
    teamId: "T1",
    files: [image],
  });
});
