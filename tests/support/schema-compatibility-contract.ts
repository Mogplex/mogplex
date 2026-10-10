import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestShim, type Queryable } from "@/lib/db/postgrest-shim";
import { runProductionSmokeChecks } from "@/lib/production-smoke";
import { buildResourceOwnershipInsert } from "@/lib/team-resource-scope";
import { WORKSPACE_COLUMNS } from "@/lib/workspaces";
import { surfaceDefaultModel } from "@/lib/models/surface-defaults";
import {
  claimPendingJob,
  recordStartAttempt,
} from "@/lib/workflows/automation-job-persistence";

const BEFORE_USER = "00000000-0000-4000-8000-000000000001";
const AFTER_USER = "00000000-0000-4000-8000-000000000002";
const completedJob = {
  status: "success",
  metadata: { compatibility: true, completed: true },
};

// Copied into the archived release by the runner. Every @ import resolves
// inside that release, so current implementations cannot mask a regression.
export async function checkSchemaCompatibility(
  db: Queryable,
  phase: "seed" | "verify"
) {
  const client = createPostgrestShim(db);
  const adminClient = client as unknown as SupabaseClient;
  if (phase === "verify") {
    const team = await client
      .from("teams")
      .select("name,slug,owner_user_id")
      .eq("id", BEFORE_USER)
      .single();
    assert.equal(team.error, null, JSON.stringify(team.error));
    assert.deepEqual(team.data, {
      name: "Existing team",
      slug: "compatibility-team-seed",
      owner_user_id: BEFORE_USER,
    });
    const membership = await client
      .from("team_members")
      .select("role")
      .eq("team_id", BEFORE_USER)
      .eq("user_id", BEFORE_USER)
      .single();
    assert.equal(membership.error, null, JSON.stringify(membership.error));
    assert.deepEqual(membership.data, { role: "owner" });
    const profile = await client
      .from("profiles")
      .select("email,default_model,surface_models")
      .eq("id", BEFORE_USER)
      .single();
    assert.equal(profile.error, null, JSON.stringify(profile.error));
    assert.deepEqual(profile.data, {
      email: "compatibility-before@example.test",
      default_model: "openai/compatibility-default",
      surface_models: { chat: "openai/compatibility-chat", slack: null },
    });
    assert.equal(
      surfaceDefaultModel(profile.data, "slack"),
      "openai/compatibility-default"
    );
    const savedChain = await client.rpc("save_model_chain", {
      p_user_id: BEFORE_USER,
      p_primary: "openai/compatibility-next",
      p_fallbacks: [],
      p_previous_resolved: "openai/compatibility-default",
    });
    assert.equal(savedChain.error, null, JSON.stringify(savedChain.error));
    const nextProfile = await client
      .from("profiles")
      .select("default_model,surface_models")
      .eq("id", BEFORE_USER)
      .single();
    assert.equal(nextProfile.error, null, JSON.stringify(nextProfile.error));
    const nextSettings = nextProfile.data as {
      default_model: string;
      surface_models: Record<string, string | null>;
    };
    assert.equal(
      surfaceDefaultModel(nextSettings, "slack"),
      "openai/compatibility-next"
    );
    assert.equal(
      surfaceDefaultModel(nextSettings, "chat"),
      "openai/compatibility-chat"
    );
    const job = await client
      .from("job_runs")
      .select("id,status,metadata,retry_of_job_run_id")
      .eq("status", "success")
      .single();
    assert.equal(job.error, null, JSON.stringify(job.error));
    const savedJob = job.data as {
      id: string;
      status: string;
      metadata: unknown;
      retry_of_job_run_id: string | null;
    };
    assert.deepEqual(
      { status: savedJob.status, metadata: savedJob.metadata },
      completedJob
    );
    assert.equal(savedJob.retry_of_job_run_id, null);
    const savedRetry = await client
      .from("job_runs")
      .select("retry_of_job_run_id,metadata")
      .eq("status", "failed")
      .single();
    assert.equal(savedRetry.error, null, JSON.stringify(savedRetry.error));
    assert.deepEqual(savedRetry.data, {
      retry_of_job_run_id: savedJob.id,
      metadata: { compatibility: true, retry: true },
    });
    const conversation = await client
      .from("control_sessions")
      .select("title,messages,pinned,archived")
      .eq("id", BEFORE_USER)
      .single();
    assert.equal(conversation.error, null, JSON.stringify(conversation.error));
    assert.deepEqual(conversation.data, {
      title: "Existing conversation",
      messages: [],
      pinned: true,
      archived: true,
    });
    const legacy = await client
      .from("control_sessions")
      .select("repo_id,project,messages,pinned,archived")
      .eq("user_id", BEFORE_USER)
      .eq("title", "Unlinked planning")
      .single();
    assert.equal(legacy.error, null, JSON.stringify(legacy.error));
    assert.deepEqual(legacy.data, {
      repo_id: null,
      project: "unmatched-planning-project",
      messages: [
        { role: "user", parts: [{ type: "text", text: "Saved plan" }] },
      ],
      pinned: false,
      archived: false,
    });
    const activeControl = await client
      .from("ai_calls")
      .select("status,conversation_id,metadata")
      .eq("id", BEFORE_USER)
      .single();
    assert.equal(
      activeControl.error,
      null,
      JSON.stringify(activeControl.error)
    );
    assert.deepEqual(activeControl.data, {
      status: "streaming",
      conversation_id: BEFORE_USER,
      metadata: { surface: "control", compatibility: true },
    });
    const progress = await client
      .from("ai_calls")
      .update({
        metadata: {
          surface: "control",
          compatibility: true,
          progress: "retained-worker",
        },
      })
      .eq("id", BEFORE_USER);
    assert.equal(progress.error, null, JSON.stringify(progress.error));
    const finished = await client
      .from("ai_calls")
      .update({ status: "success" })
      .eq("id", BEFORE_USER);
    assert.equal(finished.error, null, JSON.stringify(finished.error));
    const nextControl = await client.from("ai_calls").insert({
      user_id: BEFORE_USER,
      conversation_id: BEFORE_USER,
      type: "agent",
      model: "fixture",
      status: "pending",
      metadata: { surface: "control" },
    });
    assert.equal(nextControl.error, null, JSON.stringify(nextControl.error));
    const run = await client
      .from("external_agent_runs")
      .select("status,metadata")
      .eq("user_id", BEFORE_USER)
      .single();
    assert.equal(run.error, null, JSON.stringify(run.error));
    assert.deepEqual(run.data, {
      status: "pending",
      metadata: {
        run_origin: "slack",
        slack_model_id: "openai/compatibility-slack",
      },
    });
  }
  const userId = phase === "seed" ? BEFORE_USER : AFTER_USER;
  const profile = await client.from("profiles").insert({
    id: userId,
    default_model: "openai/compatibility-default",
    surface_models: { chat: "openai/compatibility-chat", slack: null },
    email:
      phase === "seed"
        ? "compatibility-before@example.test"
        : "compatibility-after@example.test",
  });
  assert.equal(profile.error, null, JSON.stringify(profile.error));
  const team = await client
    .from("teams")
    .insert({
      id: userId,
      name: phase === "seed" ? "Existing team" : "Retained release team",
      slug: `compatibility-team-${phase}`,
      owner_user_id: userId,
    })
    .select("id,name,slug,owner_user_id")
    .single();
  assert.equal(team.error, null, JSON.stringify(team.error));
  assert.equal((team.data as { owner_user_id: string }).owner_user_id, userId);
  const owner = buildResourceOwnershipInsert({
    kind: "personal",
    userId,
    productTeamId: null,
  });
  const workspace = await client
    .from("workspaces")
    .insert({ ...owner, name: "Compatibility fixture", is_default: true })
    .select(WORKSPACE_COLUMNS)
    .single();
  assert.equal(workspace.error, null, JSON.stringify(workspace.error));
  const workspaceId = (workspace.data as { id: string }).id;
  const repo = await client
    .from("repos")
    .insert({
      ...owner,
      full_name: `compatibility/${phase}`,
      workspace_id: workspaceId,
    })
    .select("id,workspace_id")
    .single();
  assert.equal(repo.error, null, JSON.stringify(repo.error));
  // Exercise the serving app's session writes and the old Slack worker's
  // external-run insert without depending on any candidate-only columns.
  const conversation = await client.from("control_sessions").insert({
    id: userId,
    user_id: userId,
    repo_id: (repo.data as { id: string }).id,
    title: "Existing conversation",
    messages: [],
    pinned: true,
    archived: true,
  });
  assert.equal(conversation.error, null, JSON.stringify(conversation.error));
  const legacy = await client.from("control_sessions").insert({
    user_id: userId,
    repo_id: null,
    project: "unmatched-planning-project",
    title: "Unlinked planning",
    messages: [{ role: "user", parts: [{ type: "text", text: "Saved plan" }] }],
  });
  assert.equal(legacy.error, null, JSON.stringify(legacy.error));
  const call = await client.from("ai_calls").insert({
    id: userId,
    user_id: userId,
    type: "agent",
    model: "fixture",
    conversation_id: userId,
    status: "streaming",
    metadata: { surface: "control", compatibility: true },
  });
  assert.equal(call.error, null, JSON.stringify(call.error));
  const externalRun = await client.from("external_agent_runs").insert({
    user_id: userId,
    repo_id: (repo.data as { id: string }).id,
    ai_call_id: userId,
    idempotency_key: `compatibility-${phase}`,
    request_hash: "fixture",
    harness: "mogplex",
    status: "pending",
    prompt: "Existing Slack request",
    base_branch: "main",
    working_branch: "fix/fixture",
    metadata: {
      run_origin: "slack",
      slack_model_id: "openai/compatibility-slack",
    },
  });
  assert.equal(externalRun.error, null, JSON.stringify(externalRun.error));
  const job = await client
    .from("job_runs")
    .insert({
      status: "pending",
      runtime_provider: "trigger",
      metadata: { compatibility: true },
    })
    .select("id,status,metadata")
    .single();
  assert.equal(job.error, null, JSON.stringify(job.error));
  const jobId = (job.data as { id: string }).id;
  const attempted = await recordStartAttempt({
    jobRunId: jobId,
    source: "api",
    adminClient,
  });
  assert.equal(attempted.notFound, false);
  const claim = await claimPendingJob({
    jobRunId: jobId,
    repoId: (repo.data as { id: string }).id,
    installationId: null,
    claimedAt: attempted.attemptedAt,
    adminClient,
  });
  assert.equal(claim.claimed, true, JSON.stringify(claim));
  assert.equal(claim.status, "running");
  const updated = await client
    .from("job_runs")
    .update(completedJob)
    .eq("id", jobId)
    .select("status,metadata")
    .single();
  assert.equal(updated.error, null, JSON.stringify(updated.error));
  assert.deepEqual(updated.data, completedJob);
  const retry = await client.from("job_runs").insert({
    status: "failed",
    retry_of_job_run_id: jobId,
    metadata: { compatibility: true, retry: true },
  });
  assert.equal(retry.error, null, JSON.stringify(retry.error));
  const smoke = await runProductionSmokeChecks({}, adminClient);
  assert.equal(smoke.ok, true, JSON.stringify(smoke));
  console.log(
    JSON.stringify({
      phase,
      checks: smoke.checks.map((check) => check.name),
      writes: true,
      workerRpc: true,
    })
  );
}
