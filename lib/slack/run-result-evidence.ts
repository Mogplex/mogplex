import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGithubAccessTokenForRepo } from "@/lib/github-access";

export type RunResultContext = {
  id: string;
  metadata: unknown;
  user_id?: string | null;
  ai_call_id?: string | null;
  repo_id?: string;
  prompt?: string;
  working_branch?: string;
  sandbox_record_id?: string | null;
  slack_progress?: unknown;
};
export type RunGithubEvidence = {
  checked: boolean;
  branch: { sha: string; url: string } | null;
  pullRequests: Array<{
    number: number;
    state: "open" | "closed" | "merged" | "draft";
    url: string;
  }>;
};
export type RunResultEvidence = {
  github: RunGithubEvidence;
  workspace: {
    status: string;
    persistent: boolean;
    snapshotRecorded: boolean;
  } | null;
};
const emptyGithub = (): RunGithubEvidence => ({
  checked: false,
  branch: null,
  pullRequests: [],
});
export const emptyRunResultEvidence = (): RunResultEvidence => ({
  github: emptyGithub(),
  workspace: null,
});
const repoSchema = z.object({
  full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  user_id: z.string(),
  github_installation_id: z.number().nullable().optional(),
});
const branchSchema = z.object({
  commit: z.object({ sha: z.string().regex(/^[a-f\d]{40}$/i) }),
});
const pullSchema = z.object({
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  draft: z.boolean().optional(),
  merged_at: z.string().nullable(),
  head: z.object({
    ref: z.string(),
    repo: z.object({ full_name: z.string() }).nullable(),
  }),
  base: z.object({ repo: z.object({ full_name: z.string() }) }),
});

/** Read-only provider verification; never follows links supplied in model output. */
export async function readRunGithubEvidence(
  input: { repoFullName: string; branch: string; token: string },
  request: typeof fetch = fetch
): Promise<RunGithubEvidence> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(input.repoFullName)) return emptyGithub();
  const root = `https://api.github.com/repos/${input.repoFullName}`;
  const query = new URLSearchParams({
    state: "all",
    head: `${input.repoFullName.split("/")[0]}:${input.branch}`,
    sort: "updated",
    direction: "desc",
    per_page: "100",
  });
  const get = async (url: string) =>
    request(url, {
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  const [branch, pulls] = await Promise.allSettled([
    get(`${root}/branches/${encodeURIComponent(input.branch)}`).then(
      async (res) => (res.ok ? branchSchema.parse(await res.json()) : null)
    ),
    get(`${root}/pulls?${query}`).then(async (res) =>
      res.ok ? z.array(pullSchema).parse(await res.json()) : null
    ),
  ]);
  const remote = branch.status === "fulfilled" ? branch.value : null;
  const list = pulls.status === "fulfilled" ? pulls.value : null;
  return {
    checked: list !== null,
    branch: remote
      ? {
          sha: remote.commit.sha,
          url: `https://github.com/${input.repoFullName}/tree/${remote.commit.sha}`,
        }
      : null,
    pullRequests: (list ?? [])
      .filter(
        (pr) =>
          pr.head.ref === input.branch &&
          pr.head.repo?.full_name.toLowerCase() ===
            input.repoFullName.toLowerCase() &&
          pr.base.repo.full_name.toLowerCase() ===
            input.repoFullName.toLowerCase()
      )
      .slice(0, 3)
      .map((pr) => ({
        number: pr.number,
        state: pr.merged_at
          ? "merged"
          : pr.draft && pr.state === "open"
            ? "draft"
            : pr.state,
        url: `https://github.com/${input.repoFullName}/pull/${pr.number}`,
      })),
  };
}

/** Owner-scoped records are evidence, not a claim that a VM or snapshot is live. */
export async function loadRunResultEvidence(
  run: RunResultContext
): Promise<RunResultEvidence> {
  const evidence = emptyRunResultEvidence();
  if (!run.user_id || !run.repo_id) return evidence;
  const [repoResult, workspaceResult] = await Promise.all([
    supabaseAdmin
      .from("repos")
      .select("full_name,user_id,github_installation_id")
      .eq("id", run.repo_id)
      .eq("user_id", run.user_id)
      .eq("is_hidden", false)
      .maybeSingle(),
    run.sandbox_record_id
      ? supabaseAdmin
          .from("sandboxes")
          .select("status,persistent,snapshot_id,working_branch")
          .eq("id", run.sandbox_record_id)
          .eq("user_id", run.user_id)
          .eq("repo_id", run.repo_id)
          .maybeSingle()
      : null,
  ]);
  const workspace = z
    .object({
      status: z.string(),
      persistent: z.boolean().nullable(),
      snapshot_id: z.string().nullable(),
      working_branch: z.string(),
    })
    .safeParse(workspaceResult?.data);
  if (
    !workspaceResult?.error &&
    workspace.success &&
    workspace.data.working_branch === run.working_branch
  ) {
    evidence.workspace = {
      status: workspace.data.status,
      persistent: workspace.data.persistent === true,
      snapshotRecorded: Boolean(workspace.data.snapshot_id),
    };
  }
  const repo = repoSchema.safeParse(repoResult.data);
  if (repoResult.error || !repo.success || !run.working_branch) return evidence;
  try {
    const token = await getGithubAccessTokenForRepo(repo.data);
    if (token)
      evidence.github = await readRunGithubEvidence({
        repoFullName: repo.data.full_name,
        branch: run.working_branch,
        token,
      });
  } catch {
    // Missing credentials/provider outages must not leave a finished card active.
  }
  return evidence;
}
