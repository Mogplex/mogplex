import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestShim, type Queryable } from "@/lib/db/postgrest-shim";
import { runProductionSmokeChecks } from "@/lib/production-smoke";
import { buildResourceOwnershipInsert } from "@/lib/team-resource-scope";
import { WORKSPACE_COLUMNS } from "@/lib/workspaces";
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
    const profile = await client
      .from("profiles")
      .select("email,default_model,surface_models")
      .eq("id", BEFORE_USER)
      .single();
    assert.equal(profile.error, null, JSON.stringify(profile.error));
    assert.deepEqual(profile.data, {
      email: "compatibility-before@example.test",
      default_model: "openai/compatibility-default",
      surface_models: { chat: "openai/compatibility-chat" },
    });
    const job = await client
      .from("job_runs")
      .select("status,metadata")
      .eq("status", "success")
      .single();
    assert.equal(job.error, null, JSON.stringify(job.error));
    assert.deepEqual(job.data, completedJob);
  }
  const userId = phase === "seed" ? BEFORE_USER : AFTER_USER;
  const profile = await client.from("profiles").insert({
    id: userId,
    default_model: "openai/compatibility-default",
    surface_models: { chat: "openai/compatibility-chat" },
    email:
      phase === "seed"
        ? "compatibility-before@example.test"
        : "compatibility-after@example.test",
  });
  assert.equal(profile.error, null, JSON.stringify(profile.error));
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
