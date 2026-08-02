import { supabaseAdmin } from "@/lib/supabase/admin";

const DAY_MS = 24 * 60 * 60 * 1000;

export type BaselineReaperConfig = {
  maxAgeDays: number;
  idleDays: number;
  now?: () => Date;
};

export type BaselineReaperCandidate = {
  id: string;
  full_name: string;
  snapshot_id: string | null;
  snapshot_created_at: string | null;
  snapshot_billing_team_id: string | null;
  snapshot_billing_project_id: string | null;
  last_sandbox_launch_at: string | null;
};

export type BaselineReaperDecision =
  | { reap: false; reason: "no_snapshot" | "young_and_active" }
  | { reap: true; reason: "stale_age" | "idle" | "missing_timestamp" };

export function shouldReapBaselineSnapshot(
  repo: BaselineReaperCandidate,
  config: Pick<BaselineReaperConfig, "maxAgeDays" | "idleDays"> & {
    now: Date;
  }
): BaselineReaperDecision {
  if (!repo.snapshot_id) return { reap: false, reason: "no_snapshot" };

  if (!repo.snapshot_created_at) {
    return { reap: true, reason: "missing_timestamp" };
  }

  const createdAt = Date.parse(repo.snapshot_created_at);
  if (!Number.isFinite(createdAt)) {
    return { reap: true, reason: "missing_timestamp" };
  }

  const ageMs = config.now.getTime() - createdAt;
  if (ageMs > config.maxAgeDays * DAY_MS) {
    return { reap: true, reason: "stale_age" };
  }

  if (repo.last_sandbox_launch_at) {
    const lastMs = Date.parse(repo.last_sandbox_launch_at);
    if (Number.isFinite(lastMs)) {
      const idleMs = config.now.getTime() - lastMs;
      if (idleMs > config.idleDays * DAY_MS) {
        return { reap: true, reason: "idle" };
      }
    }
  } else if (ageMs > config.idleDays * DAY_MS) {
    // No recorded launch ever, but snapshot exists — treat as idle after
    // grace period of idleDays so we don't reap a brand-new baseline before
    // anyone has had a chance to use it.
    return { reap: true, reason: "idle" };
  }

  return { reap: false, reason: "young_and_active" };
}

type DeleteSnapshotFn = (input: {
  snapshotId: string;
  token: string;
  teamId: string | null;
}) => Promise<void>;

export type BaselineReaperSummary = {
  processed: number;
  reaped: number;
  message: string;
  reasons: Record<BaselineReaperDecision["reason"], number>;
};

type BaselineReaperDeps = {
  loadCandidates: () => Promise<BaselineReaperCandidate[]>;
  clearRepoSnapshot: (repoId: string) => Promise<void>;
  deleteSnapshot: DeleteSnapshotFn;
  resolveSnapshotCredentials: (
    repo: BaselineReaperCandidate
  ) => Promise<{ token: string; teamId: string | null } | null>;
  now: () => Date;
};

export async function runBaselineSnapshotReaper(
  config: BaselineReaperConfig,
  deps: BaselineReaperDeps
): Promise<BaselineReaperSummary> {
  const candidates = await deps.loadCandidates();
  const reasons: Record<BaselineReaperDecision["reason"], number> = {
    no_snapshot: 0,
    young_and_active: 0,
    stale_age: 0,
    idle: 0,
    missing_timestamp: 0,
  };
  let reaped = 0;
  const now = deps.now();

  for (const repo of candidates) {
    const decision = shouldReapBaselineSnapshot(repo, {
      maxAgeDays: config.maxAgeDays,
      idleDays: config.idleDays,
      now,
    });
    reasons[decision.reason] += 1;
    if (!decision.reap) continue;

    if (repo.snapshot_id) {
      const creds = await deps.resolveSnapshotCredentials(repo);
      if (creds) {
        await deps.deleteSnapshot({
          snapshotId: repo.snapshot_id,
          token: creds.token,
          teamId: creds.teamId,
        });
      }
    }
    await deps.clearRepoSnapshot(repo.id);
    reaped += 1;
  }

  return {
    processed: candidates.length,
    reaped,
    message: `Baseline snapshot reaper processed ${candidates.length} repo(s); reaped ${reaped}.`,
    reasons,
  };
}

function parseDaysEnv(value: string | undefined, fallback: number) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readBaselineReaperConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): BaselineReaperConfig {
  return {
    maxAgeDays: parseDaysEnv(env.SNAPSHOT_MAX_AGE_DAYS, 14),
    idleDays: parseDaysEnv(env.SNAPSHOT_IDLE_DAYS, 30),
  };
}

export async function loadBaselineReaperCandidates(): Promise<
  BaselineReaperCandidate[]
> {
  const { data, error } = await supabaseAdmin
    .from("repos")
    .select(
      "id, full_name, snapshot_id, snapshot_created_at, snapshot_billing_team_id, snapshot_billing_project_id"
    )
    .not("snapshot_id", "is", null);

  if (error) {
    throw new Error(
      `Failed to load baseline snapshot candidates: ${error.message}`
    );
  }

  // Augment with last_sandbox_launch_at (computed as MAX(created_at) from
  // sandboxes table per repo). Kept as a second query rather than a view so
  // the reaper remains trivially inspectable in psql.
  const repos = (data ?? []).map((row) => ({
    ...row,
    last_sandbox_launch_at: null as string | null,
  }));
  const ids = repos.map((r) => r.id);
  if (ids.length === 0) return repos;

  // Newest-first + capped: only the latest launch per repo is consumed below.
  const { data: launches, error: launchErr } = await supabaseAdmin
    .from("sandboxes")
    .select("repo_id, created_at")
    .in("repo_id", ids)
    .order("created_at", { ascending: false })
    .limit(10000);

  if (launchErr) {
    throw new Error(
      `Failed to load last sandbox launches: ${launchErr.message}`
    );
  }

  const latestByRepo = new Map<string, string>();
  for (const row of launches ?? []) {
    if (!latestByRepo.has(row.repo_id)) {
      latestByRepo.set(row.repo_id, row.created_at);
    }
  }

  for (const repo of repos) {
    repo.last_sandbox_launch_at = latestByRepo.get(repo.id) ?? null;
  }
  return repos;
}
