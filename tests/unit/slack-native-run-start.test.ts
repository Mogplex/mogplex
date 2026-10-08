import assert from "node:assert/strict";
import test from "node:test";
import { defaultStartRepoAgentRun } from "../../trigger/slack-event-lib/run-start";
import { startMogplexApiRun } from "../../lib/mogplex-api/runs";
import {
  buildAiCall,
  buildRunRow,
  buildStartDeps,
} from "./helpers/mogplex-api-runs-fixtures";

for (const preference of [null, "mogplex", "codex", "claude-code"] as const) {
  test(`Slack message and image honor harness preference ${preference ?? "default"}`, async () => {
    let stored = buildRunRow();
    let observedCall = buildAiCall();
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
          // Stale/caller context must not override the server-resolved target.
          extraMetadata: {
            ...input.extraMetadata,
            repo: "Mogplex/mogplex",
            repo_full_name: "Mogplex/mogplex",
          },
          deps: buildStartDeps({
            loadOwnedRepo: async (repoId, _userId) => {
              assert.equal(repoId, stored.repo_id);
              return {
                id: repoId,
                full_name: "webrenew/gtm-supahost",
                default_branch: "main",
                root_directory: null,
              };
            },
            createAiCall: async (input) => {
              observedCall = buildAiCall({
                repo_id: input.repoId,
                metadata: input.metadata,
              });
              return observedCall;
            },
            insertRun: async (insert) => {
              stored = buildRunRow({
                harness: insert.normalized.harness,
                metadata: insert.metadata,
              });
              return stored;
            },
            markRunQueued: async () => stored,
          }),
        }),
      async (scope) => {
        assert.deepEqual(scope, {
          installationId: "installation-1",
          channelId: "D1",
          slackUserId: "U1",
        });
        return preference;
      },
      async () => {},
      async () => null,
      async (scope) => {
        assert.equal(scope.channelId, "D1");
        return { model_id: "openai/gpt-6-astra" };
      }
    );
    assert.equal(result.runId, stored.id);
    assert.equal(stored.harness, preference ?? "mogplex");
    assert.equal(stored.metadata.harness_id, preference ?? "mogplex");
    for (const metadata of [stored.metadata, observedCall.metadata!]) {
      assert.equal(metadata.run_origin, "slack");
      assert.equal(metadata.repo, "webrenew/gtm-supahost");
      assert.equal(metadata.repo_full_name, "webrenew/gtm-supahost");
      assert.equal(metadata.repo_id, stored.repo_id);
    }
    assert.equal(
      stored.metadata.slack_model_id,
      preference === null || preference === "mogplex"
        ? "openai/gpt-6-astra"
        : undefined
    );
    assert.deepEqual(stored.metadata.slack_image_attachments, {
      teamId: "T1",
      files: [image],
    });
  });
}

test("Slack repository runs carry the channel's pinned roster agent", async () => {
  let stored = buildRunRow();
  let resolvedFor: { agentId: string; userId: string } | null = null;
  const result = await defaultStartRepoAgentRun(
    {
      mogplexUserId: stored.user_id,
      repoId: stored.repo_id,
      prompt: "Audit the auth routes",
      idempotencyKey: "slack:message:agent",
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
          resolveAgent: async (args) => {
            resolvedFor = args;
            return {
              id: args.agentId,
              name: "Security Sweep",
              slug: "security-sweep",
              model: null,
              systemPrompt: "Look for auth bypasses.",
              skills: [],
              rules: [],
              preset: false,
              teamId: null,
              ownerUserId: args.userId,
            };
          },
          insertRun: async (insert) => {
            stored = buildRunRow({
              harness: insert.normalized.harness,
              agent_id: insert.normalized.agentId,
              metadata: insert.metadata,
            });
            return stored;
          },
          markRunQueued: async () => stored,
        }),
      }),
    async () => "codex",
    async () => {},
    async () => "agent-7",
    async () => null
  );
  assert.equal(result.runId, stored.id);
  assert.deepEqual(resolvedFor, { agentId: "agent-7", userId: stored.user_id });
  assert.equal(stored.agent_id, "agent-7");
  assert.equal(stored.metadata.agent_name, "Security Sweep");
  assert.equal(stored.harness, "codex");
});
