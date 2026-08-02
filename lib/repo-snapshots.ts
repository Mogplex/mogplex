import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SandboxBillingMode } from "@/lib/sandbox/billing";

export const SNAPSHOT_BUILD_STALE_MS = 15 * 60 * 1000;

type SnapshotLockResult =
  | { acquired: true; token: string }
  | { acquired: false; reason: "in_progress" | "not_found" };

type SnapshotRepoState = {
  id: string;
  snapshot_build_token: string | null;
  snapshot_build_started_at: string | null;
};

async function getSnapshotRepoState(
  repoId: string
): Promise<SnapshotRepoState | null> {
  const { data, error } = await supabaseAdmin
    .from("repos")
    .select("id, snapshot_build_token, snapshot_build_started_at")
    .eq("id", repoId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load snapshot state for repo ${repoId}: ${error.message}`
    );
  }

  return data;
}

export function isSnapshotBuildStale(
  startedAt: string | null,
  now = Date.now()
) {
  if (!startedAt) return true;
  return now - new Date(startedAt).getTime() > SNAPSHOT_BUILD_STALE_MS;
}

export async function acquireSnapshotBuildLock(
  repoId: string
): Promise<SnapshotLockResult> {
  const current = await getSnapshotRepoState(repoId);
  if (!current) {
    return { acquired: false, reason: "not_found" };
  }

  if (
    current.snapshot_build_token &&
    !isSnapshotBuildStale(current.snapshot_build_started_at)
  ) {
    return { acquired: false, reason: "in_progress" };
  }

  const token = crypto.randomUUID();
  const update = {
    snapshot_build_token: token,
    snapshot_build_started_at: new Date().toISOString(),
  };

  let query = supabaseAdmin.from("repos").update(update).eq("id", repoId);

  query = current.snapshot_build_token
    ? query.eq("snapshot_build_token", current.snapshot_build_token)
    : query.is("snapshot_build_token", null);

  const { data, error } = await query.select("id").maybeSingle();

  if (error) {
    throw new Error(
      `Failed to acquire snapshot build lock for repo ${repoId}: ${error.message}`
    );
  }

  if (!data) {
    return { acquired: false, reason: "in_progress" };
  }

  return { acquired: true, token };
}

export async function persistSnapshotBuild(
  repoId: string,
  token: string,
  snapshotId: string,
  ownership: {
    billingSource: SandboxBillingMode;
    billingProjectId: string;
    billingTeamId: string | null;
  },
  metadata?: {
    lockfileHash?: string | null;
    commitSha?: string | null;
  }
) {
  const { data, error } = await supabaseAdmin
    .from("repos")
    .update({
      snapshot_id: snapshotId,
      snapshot_created_at: new Date().toISOString(),
      snapshot_lockfile_hash: metadata?.lockfileHash ?? null,
      snapshot_commit_sha: metadata?.commitSha ?? null,
      snapshot_billing_source: ownership.billingSource,
      snapshot_billing_project_id: ownership.billingProjectId,
      snapshot_billing_team_id: ownership.billingTeamId,
      snapshot_build_token: null,
      snapshot_build_started_at: null,
    })
    .eq("id", repoId)
    .eq("snapshot_build_token", token)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to persist snapshot ${snapshotId} for repo ${repoId}: ${error.message}`
    );
  }

  return Boolean(data);
}

export async function releaseSnapshotBuildLock(repoId: string, token: string) {
  const { error } = await supabaseAdmin
    .from("repos")
    .update({
      snapshot_build_token: null,
      snapshot_build_started_at: null,
    })
    .eq("id", repoId)
    .eq("snapshot_build_token", token);

  if (error) {
    throw new Error(
      `Failed to release snapshot build lock for repo ${repoId}: ${error.message}`
    );
  }
}

export async function clearRepoSnapshotIfCurrent(
  repoId: string,
  snapshotId: string
) {
  const { error } = await supabaseAdmin
    .from("repos")
    .update({
      snapshot_id: null,
      snapshot_lockfile_hash: null,
      snapshot_created_at: null,
      snapshot_commit_sha: null,
      snapshot_billing_source: null,
      snapshot_billing_project_id: null,
      snapshot_billing_team_id: null,
    })
    .eq("id", repoId)
    .eq("snapshot_id", snapshotId);

  if (error) {
    throw new Error(
      `Failed to clear snapshot ${snapshotId} for repo ${repoId}: ${error.message}`
    );
  }
}
