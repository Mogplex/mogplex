import { buildHarnessWorkingBranch } from "@/lib/harness/git-delivery";
import { getGithubAccessTokenForRepo } from "@/lib/github-access";
import { deleteEmptyRunBranch } from "@/lib/github/run-branch-cleanup";
import type { AiCall } from "@/lib/types";
import type { ExternalAgentRunRow } from "./runs-types";

type RunRepo = {
  user_id: string;
  full_name: string;
  github_installation_id: number | null;
};

async function loadRunRepo(run: ExternalAgentRunRow): Promise<RunRepo | null> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data } = await supabaseAdmin
    .from("repos")
    .select("user_id, full_name, github_installation_id")
    .eq("id", run.repo_id)
    .maybeSingle();
  return (data as RunRepo | null) ?? null;
}

const defaultDeps = {
  loadRepo: loadRunRepo,
  loadToken: (repo: RunRepo, actorUserId: string) =>
    getGithubAccessTokenForRepo(repo, actorUserId),
  deleteBranch: deleteEmptyRunBranch,
};

/**
 * The branches this run created: its own working branch when it asked for a
 * fresh one, and the fallback a CLI harness creates when it was pointed at the
 * base branch. A branch the caller supplied is never treated as the run's.
 */
export function branchesCreatedByRun(
  run: Pick<
    ExternalAgentRunRow,
    "create_branch" | "working_branch" | "base_branch" | "ai_call_id"
  >,
  call: Pick<AiCall, "metadata"> | null
): string[] {
  const branches = new Set<string>();
  if (run.create_branch && run.working_branch !== run.base_branch) {
    branches.add(run.working_branch);
  }
  const pushed = call?.metadata?.working_branch;
  if (
    run.ai_call_id &&
    typeof pushed === "string" &&
    pushed === buildHarnessWorkingBranch(run.ai_call_id)
  ) {
    branches.add(pushed);
  }
  return [...branches];
}

/**
 * Remove the empty branches a finished run pushed at boot. Best-effort and
 * idempotent: finalization can run more than once, and a failure here never
 * affects the run's outcome.
 */
export async function cleanupTerminalRunBranches(
  run: ExternalAgentRunRow,
  call: Pick<AiCall, "metadata"> | null,
  overrides: Partial<typeof defaultDeps> = {}
): Promise<void> {
  // Worktree runs share a long-lived checkout; their branches are not the run's.
  if (run.worktree_id) return;
  const branches = branchesCreatedByRun(run, call);
  if (branches.length === 0) return;
  const deps = { ...defaultDeps, ...overrides };
  try {
    const repo = await deps.loadRepo(run);
    const [owner, name] = repo?.full_name.split("/") ?? [];
    if (!repo || !owner || !name) return;
    const githubToken = await deps.loadToken(repo, run.user_id);
    if (!githubToken) return;
    await Promise.all(
      branches.map((branch) =>
        deps.deleteBranch({
          owner,
          repo: name,
          baseBranch: run.base_branch,
          branch,
          githubToken,
        })
      )
    );
  } catch (error) {
    console.warn("[run-branch-cleanup] terminal run cleanup failed", {
      runId: run.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
