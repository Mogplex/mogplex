import { NextResponse } from "next/server";
import { Snapshot } from "@vercel/sandbox";
import { getSandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clearRepoSnapshotIfCurrent } from "@/lib/repo-snapshots";
import { buildLimitResponse } from "@/lib/request-limits";
import { buildRepoSnapshot } from "@/lib/repo-snapshot-build";
import { resolveSnapshotContext } from "@/lib/sandbox/context";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes";

type SnapshotRepoRecord = {
  id: string;
  user_id: string;
  full_name: string;
  default_branch: string | null;
  root_directory: string | null;
  sandbox_billing_target?: unknown;
  sandbox_billing_mode_override?: unknown;
  runtime: SandboxRuntime | null;
  dev_port: number;
  dev_port_auto?: unknown;
  install_command: string | null;
  dev_command: string | null;
  sandbox_env_vars?: unknown;
  env_sync_mode?: unknown;
  vercel_project_id?: string | null;
  vercel_team_id?: string | null;
  snapshot_id: string | null;
  snapshot_created_at?: string | null;
  snapshot_billing_source?: string | null;
  snapshot_billing_team_id?: string | null;
  snapshot_billing_project_id?: string | null;
  workspace?:
    | {
        sandbox_billing_mode?: unknown;
        sandbox_vercel_project_id?: string | null;
        sandbox_vercel_team_id?: string | null;
      }
    | Array<{
        sandbox_billing_mode?: unknown;
        sandbox_vercel_project_id?: string | null;
        sandbox_vercel_team_id?: string | null;
      }>
    | null;
};

export async function resolveSnapshotCredentialsForRepo(
  creds: Awaited<ReturnType<typeof getSandboxServiceCredentials>>,
  repo: Pick<
    SnapshotRepoRecord,
    | "snapshot_billing_source"
    | "snapshot_billing_project_id"
    | "snapshot_billing_team_id"
    | "sandbox_billing_mode_override"
    | "vercel_project_id"
    | "vercel_team_id"
    | "workspace"
  >
) {
  if (!creds) {
    return { ok: false as const, error: "Unauthorized", status: 401 as const };
  }

  const resolved = await resolveSnapshotContext({
    sandboxCredentials: creds,
    repo,
  });

  return resolved.ok
    ? {
        ok: true as const,
        vercelToken: resolved.context.credentials.vercelToken,
        vercelTeamId: resolved.context.credentials.vercelTeamId,
        vercelProjectId: resolved.context.credentials.vercelProjectId,
      }
    : {
        ok: false as const,
        error: resolved.error,
        status: resolved.status as 400 | 403 | 500,
      };
}

type SnapshotPostDeps = {
  getSandboxServiceCredentials: typeof getSandboxServiceCredentials;
  loadOwnedRepo: (
    repoId: string,
    userId: string
  ) => Promise<SnapshotRepoRecord | null>;
  buildRepoSnapshot: typeof buildRepoSnapshot;
};

const defaultSnapshotPostDeps: SnapshotPostDeps = {
  getSandboxServiceCredentials,
  async loadOwnedRepo(repoId, userId) {
    const { data } = await supabaseAdmin
      .from("repos")
      .select(
        "*, workspace:workspaces(sandbox_billing_mode, sandbox_vercel_project_id, sandbox_vercel_team_id)"
      )
      .eq("id", repoId)
      .eq("user_id", userId)
      .single();

    return (data as SnapshotRepoRecord | null) ?? null;
  },
  buildRepoSnapshot,
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const creds = await getSandboxServiceCredentials();
  if (!creds)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: repo } = await supabaseAdmin
    .from("repos")
    .select(
      "id, full_name, snapshot_id, snapshot_lockfile_hash, snapshot_created_at, snapshot_commit_sha, snapshot_billing_source, snapshot_billing_project_id, snapshot_billing_team_id, sandbox_billing_mode_override, vercel_project_id, vercel_team_id, workspace:workspaces(sandbox_billing_mode, sandbox_vercel_project_id, sandbox_vercel_team_id)"
    )
    .eq("id", id)
    .eq("user_id", creds.userId)
    .single();

  if (!repo)
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  if (!repo.snapshot_id) {
    return NextResponse.json({ snapshot: null });
  }

  const sandboxCredentials = await resolveSnapshotCredentialsForRepo(
    creds,
    repo
  );
  if (!sandboxCredentials.ok) {
    return NextResponse.json(
      { error: sandboxCredentials.error },
      { status: sandboxCredentials.status }
    );
  }

  // Verify snapshot still exists
  try {
    const snapshot = await Snapshot.get({
      snapshotId: repo.snapshot_id,
      token: sandboxCredentials.vercelToken,
      ...(sandboxCredentials.vercelTeamId
        ? { teamId: sandboxCredentials.vercelTeamId }
        : {}),
    });
    return NextResponse.json({
      snapshot: {
        id: snapshot.snapshotId,
        status: snapshot.status,
        sizeBytes: snapshot.sizeBytes,
        createdAt: snapshot.createdAt.toISOString(),
        expiresAt: snapshot.expiresAt?.toISOString() || null,
        commitSha: repo.snapshot_commit_sha,
        lockfileHash: repo.snapshot_lockfile_hash,
      },
    });
  } catch {
    // Snapshot deleted externally — clear it
    await clearRepoSnapshotIfCurrent(id, repo.snapshot_id);
    return NextResponse.json({ snapshot: null });
  }
}

export function createSnapshotPostHandler(
  overrides: Partial<SnapshotPostDeps> = {}
) {
  const deps: SnapshotPostDeps = {
    ...defaultSnapshotPostDeps,
    ...overrides,
  };

  return async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    const creds = await deps.getSandboxServiceCredentials();
    if (!creds)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const repo = await deps.loadOwnedRepo(id, creds.userId);
    if (!repo)
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });

    try {
      const result = await deps.buildRepoSnapshot({
        repo,
        sandboxCredentials: creds,
      });

      if (result.status === "missing_github_token") {
        return NextResponse.json(
          { error: "Connect GitHub account first" },
          { status: 400 }
        );
      }

      if (result.status === "invalid_target") {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      if (result.status === "missing_vercel_credentials") {
        return NextResponse.json(
          { error: result.error },
          { status: result.statusCode }
        );
      }

      if (result.status === "rate_limited") {
        return buildLimitResponse(result.decision);
      }

      if (result.status === "in_progress") {
        return NextResponse.json(
          { error: "Snapshot build already in progress" },
          { status: 409 }
        );
      }

      if (result.status === "superseded") {
        return NextResponse.json(
          {
            error: "Snapshot build completed after a newer build superseded it",
          },
          { status: 409 }
        );
      }

      return NextResponse.json({ snapshot: result.snapshot });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Snapshot creation failed";
      console.error(
        `[snapshot] POST failed for repo ${repo.full_name}:`,
        message
      );
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export const POST = createSnapshotPostHandler();

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const creds = await getSandboxServiceCredentials();
  if (!creds)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: repo } = await supabaseAdmin
    .from("repos")
    .select(
      "id, snapshot_id, snapshot_billing_source, snapshot_billing_project_id, snapshot_billing_team_id, sandbox_billing_mode_override, vercel_project_id, vercel_team_id, workspace:workspaces(sandbox_billing_mode, sandbox_vercel_project_id, sandbox_vercel_team_id)"
    )
    .eq("id", id)
    .eq("user_id", creds.userId)
    .single();

  if (!repo)
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const sandboxCredentials = await resolveSnapshotCredentialsForRepo(
    creds,
    repo
  );
  if (!sandboxCredentials.ok) {
    return NextResponse.json(
      { error: sandboxCredentials.error },
      { status: sandboxCredentials.status }
    );
  }

  if (repo.snapshot_id) {
    try {
      const snapshot = await Snapshot.get({
        snapshotId: repo.snapshot_id,
        token: sandboxCredentials.vercelToken,
        ...(sandboxCredentials.vercelTeamId
          ? { teamId: sandboxCredentials.vercelTeamId }
          : {}),
      });
      await snapshot.delete();
    } catch {
      // Already deleted
    }
  }

  if (repo.snapshot_id) {
    await clearRepoSnapshotIfCurrent(id, repo.snapshot_id);
  }

  return NextResponse.json({ ok: true });
}
