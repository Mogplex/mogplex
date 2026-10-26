import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deliverRunGuidance,
  loadRunGuidance,
  submitSlackRunGuidance,
} from "@/lib/slack/run-guidance-store";

// Copied into the archived release beside the contract. Slack thread guidance
// written by retained releases keeps working after the inbox gains workspace
// rows with no Slack thread.
const BEFORE_USER = "00000000-0000-4000-8000-000000000001";

const SLACK_THREAD = {
  teamId: "T-compat",
  channelId: "D-compat",
  threadTs: "1.2",
  slackUserId: "U-compat",
};

function slackGuidanceInput(
  userId: string,
  runId: string,
  aiCallId: string,
  phase: "seed" | "verify"
) {
  return {
    ...SLACK_THREAD,
    userId,
    runId,
    aiCallId,
    eventId: `Ev-compat-${phase}`,
    messageTs: "1.3",
    body: "Keep the desktop header unchanged.",
    attachments: null,
  };
}

// Retained releases accept Slack thread guidance through the old inbox RPC.
export async function seedSlackGuidance(
  client: SupabaseClient,
  userId: string,
  repoId: string,
  phase: "seed" | "verify"
) {
  const call = await client
    .from("ai_calls")
    .insert({
      user_id: userId,
      type: "agent",
      model: "harness:mogplex",
      status: "streaming",
      metadata: { compatibility: "slack-guidance" },
    })
    .select("id")
    .single();
  assert.equal(call.error, null, JSON.stringify(call.error));
  const aiCallId = (call.data as { id: string }).id;
  const run = await client
    .from("external_agent_runs")
    .insert({
      user_id: userId,
      repo_id: repoId,
      ai_call_id: aiCallId,
      idempotency_key: `compatibility-guidance-${phase}`,
      request_hash: "fixture",
      harness: "mogplex",
      status: "streaming",
      prompt: "Slack-thread request",
      base_branch: "main",
      working_branch: "fix/guidance-fixture",
      metadata: {
        slack_guidance_enabled: true,
        slack_user_id: SLACK_THREAD.slackUserId,
        slack_thread_ts: SLACK_THREAD.threadTs,
        slackRunControls: {
          teamId: SLACK_THREAD.teamId,
          channelId: SLACK_THREAD.channelId,
          messageTs: SLACK_THREAD.threadTs,
        },
      },
    })
    .select("id")
    .single();
  assert.equal(run.error, null, JSON.stringify(run.error));
  const runId = (run.data as { id: string }).id;
  const receipt = await submitSlackRunGuidance(
    slackGuidanceInput(userId, runId, aiCallId, phase),
    client
  );
  assert.equal(receipt?.status, "received");
}

export async function verifySlackGuidance(client: SupabaseClient) {
  const run = await client
    .from("external_agent_runs")
    .select("id,ai_call_id")
    .eq("user_id", BEFORE_USER)
    .eq("idempotency_key", "compatibility-guidance-seed")
    .single();
  assert.equal(run.error, null, JSON.stringify(run.error));
  const { id: runId, ai_call_id: aiCallId } = run.data as {
    id: string;
    ai_call_id: string;
  };
  const owned = { id: runId, user_id: BEFORE_USER, ai_call_id: aiCallId };
  const [saved] = await loadRunGuidance(owned, client);
  assert.deepEqual(
    { body: saved?.body, status: saved?.status },
    { body: "Keep the desktop header unchanged.", status: "received" }
  );
  // A Slack webhook retry after the migration still resolves to the same row.
  const retried = await submitSlackRunGuidance(
    slackGuidanceInput(BEFORE_USER, runId, aiCallId, "seed"),
    client
  );
  assert.deepEqual(retried, { id: saved.id, status: "received" });
  const delivered = await deliverRunGuidance(
    { runId, userId: BEFORE_USER, aiCallId, ids: [saved.id], step: 1 },
    client
  );
  assert.equal(delivered, 1);
}
