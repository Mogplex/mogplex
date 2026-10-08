/**
 * Records the terminal commit SHA when a run finishes successfully.
 * This pins artifact reads to the exact commit at run completion.
 */
import { getOwnedRepoWithGithubAccessToken } from "@/lib/github-access";
import type { ExternalAgentRunRow } from "./runs-types";

type Repo = {
  user_id: string;
  full_name: string;
};

export type RecordTerminalCommitDeps = {
  loadRepo: (
    repoId: string,
    userId: string
  ) => Promise<{ repo: Repo | null; githubToken: string | null }>;
  fetchCommitSha: (
    token: string,
    fullName: string,
    branch: string
  ) => Promise<string | null>;
  updateRunMetadata: (
    userId: string,
    runId: string,
    metadata: Record<string, unknown>
  ) => Promise<void>;
};

async function fetchCommitShaFromGitHub(
  token: string,
  fullName: string,
  branch: string
): Promise<string | null> {
  try {
    const url = `https://api.github.com/repos/${fullName.split("/").map(encodeURIComponent).join("/")}/commits/${encodeURIComponent(branch)}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { sha?: unknown };
    const sha = data?.sha;
    if (typeof sha !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(sha))
      return null;
    return sha;
  } catch {
    return null;
  }
}

async function updateRunMetadataInDb(
  userId: string,
  runId: string,
  metadataUpdate: Record<string, unknown>
): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  // Read current metadata, merge, and write back. This is safe because
  // terminal commit recording happens once at run completion.
  const { data: current } = await supabaseAdmin
    .from("external_agent_runs")
    .select("metadata")
    .eq("id", runId)
    .eq("user_id", userId)
    .single();
  const merged = { ...current?.metadata, ...metadataUpdate };
  const { error } = await supabaseAdmin
    .from("external_agent_runs")
    .update({ metadata: merged })
    .eq("id", runId)
    .eq("user_id", userId);
  if (error) {
    console.warn("[terminal-commit] metadata update failed", { runId, error });
  }
}

const defaultDeps: RecordTerminalCommitDeps = {
  loadRepo: (repoId, userId) =>
    getOwnedRepoWithGithubAccessToken<Repo>(repoId, userId, {
      select: "user_id, full_name",
    }),
  fetchCommitSha: fetchCommitShaFromGitHub,
  updateRunMetadata: updateRunMetadataInDb,
};

/**
 * Record the terminal commit SHA for a successfully completed run.
 * This is best-effort and never throws. A failure to record does not affect
 * run status - artifact reads will fall back to the branch tip.
 */
export async function recordTerminalCommitSha(
  run: ExternalAgentRunRow,
  overrides: Partial<RecordTerminalCommitDeps> = {}
): Promise<void> {
  const deps = { ...defaultDeps, ...overrides };
  try {
    const { repo, githubToken } = await deps.loadRepo(run.repo_id, run.user_id);
    if (!repo || !githubToken) return;

    const sha = await deps.fetchCommitSha(
      githubToken,
      repo.full_name,
      run.working_branch
    );
    if (!sha) return;

    await deps.updateRunMetadata(run.user_id, run.id, {
      terminal_commit_sha: sha,
    });
  } catch (error) {
    console.warn("[terminal-commit] failed to record terminal commit", {
      runId: run.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
