import { z } from "zod";
import { redactSecretsInText } from "@/lib/ai-telemetry";
import {
  readSandboxBranchChanges,
  type BranchChangedFile,
  type BranchChangedFileStatus,
  type BranchChanges,
} from "@/lib/sandbox/branch-changes";

/** Where a run's changes were read from. */
export type RunChangesSource = "workspace" | "github";

export type RunChanges = BranchChanges & {
  source: RunChangesSource;
  baseBranch: string;
  branch: string;
  /** GitHub compare page, for changes read from the pushed branch. */
  webUrl?: string;
};

export type RunChangesRun = {
  id: string;
  user_id?: string | null;
  repo_id?: string;
  base_branch?: string;
  working_branch?: string;
  sandbox_record_id?: string | null;
};

export type RunChangesResult =
  | { ok: true; changes: RunChanges }
  | { ok: false; reason: "no_branch" | "not_found" };

const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

const compareSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string(),
        previous_filename: z.string().optional(),
        status: z.string(),
        additions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
        patch: z.string().optional(),
      })
    )
    .default([]),
});

function githubStatus(status: string): BranchChangedFileStatus {
  if (status === "removed") return "deleted";
  if (status === "renamed") return "renamed";
  if (status === "added" || status === "copied") return "added";
  return "modified";
}

function encodeRef(ref: string) {
  return encodeURIComponent(ref).replace(/%2F/gi, "/");
}

/**
 * Compare a pushed branch with its base. GitHub omits `patch` for binary and
 * very large files and caps the list at 300 files, which the caller shows as
 * a partial diff. A missing branch or base is `null`, not an error.
 */
export async function readGithubBranchChanges(
  input: { repoFullName: string; base: string; head: string; token: string },
  request: typeof fetch = fetch
): Promise<BranchChanges | null> {
  if (!REPO_NAME.test(input.repoFullName)) return null;
  const response = await request(
    `https://api.github.com/repos/${input.repoFullName}/compare/${encodeRef(input.base)}...${encodeRef(input.head)}`,
    {
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub compare HTTP ${response.status}`);
  const { files } = compareSchema.parse(await response.json());
  return {
    files: files.map((file) => ({
      path: file.filename,
      status: githubStatus(file.status),
      ...(file.status === "renamed" && file.previous_filename
        ? { previousPath: file.previous_filename }
        : {}),
      additions: file.additions,
      deletions: file.deletions,
      ...(file.patch === undefined ? {} : { patch: file.patch }),
    })),
    patchTruncated:
      files.length >= 300 || files.some((file) => file.patch === undefined),
  };
}

type RepoRow = {
  full_name: string;
  user_id: string;
  github_installation_id?: number | null;
};

type SandboxRow = {
  sandbox_id: string;
  root_directory: string | null;
  working_branch: string | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
};

export type RunChangesDeps = {
  loadRepo: (run: {
    userId: string;
    repoId: string;
  }) => Promise<RepoRow | null>;
  githubToken: (repo: RepoRow) => Promise<string | null>;
  readGithub: typeof readGithubBranchChanges;
  /**
   * The run's workspace if it is running right now. Never resumes a stopped
   * workspace: a Slack click must not restart billing.
   */
  liveWorkspace: (input: {
    userId: string;
    repoId: string;
    sandboxRecordId: string;
    branch: string;
  }) => Promise<{
    read: (baseBranch: string) => Promise<BranchChanges>;
  } | null>;
};

async function loadRepo({
  userId,
  repoId,
}: {
  userId: string;
  repoId: string;
}) {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data, error } = await supabaseAdmin
    .from("repos")
    .select("full_name,user_id,github_installation_id")
    .eq("id", repoId)
    .eq("user_id", userId)
    .eq("is_hidden", false)
    .maybeSingle();
  if (error) throw new Error(`Failed to load repository: ${error.message}`);
  return (data as RepoRow | null) ?? null;
}

async function githubToken(repo: RepoRow) {
  const { getGithubAccessTokenForRepo } = await import("@/lib/github-access");
  return getGithubAccessTokenForRepo(repo);
}

const SANDBOX_SELECT =
  "sandbox_id, root_directory, working_branch, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id";

async function liveWorkspace(input: {
  userId: string;
  repoId: string;
  sandboxRecordId: string;
  branch: string;
}) {
  const [
    { supabaseAdmin },
    { loadSandboxServiceCredentialsForUser },
    { resolveSandboxRecordContext },
    { getSandboxProvider },
    { resolveSandboxWorkingDirectory },
    { normalizeRootDirectory },
  ] = await Promise.all([
    import("@/lib/supabase/admin"),
    import("@/lib/sandbox/get-user-credentials"),
    import("@/lib/sandbox/context"),
    import("@/lib/sandbox/provider"),
    import("@/lib/sandbox/working-directory"),
    import("@/lib/repo-settings"),
  ]);
  const { data } = await supabaseAdmin
    .from("sandboxes")
    .select(SANDBOX_SELECT)
    .eq("id", input.sandboxRecordId)
    .eq("user_id", input.userId)
    .eq("repo_id", input.repoId)
    .maybeSingle();
  const record = data as SandboxRow | null;
  // A reused workspace may have moved on to another branch since this run.
  if (
    !record ||
    record.sandbox_id === "pending" ||
    record.working_branch !== input.branch
  )
    return null;
  const context = await resolveSandboxRecordContext({
    sandboxCredentials: await loadSandboxServiceCredentialsForUser(
      input.userId
    ),
    record,
  });
  if (!context.ok) return null;
  const sandbox = await getSandboxProvider().getIfExists(
    record.sandbox_id,
    context.context.credentials
  );
  if (sandbox?.status !== "running") return null;
  const cwd = resolveSandboxWorkingDirectory(
    undefined,
    normalizeRootDirectory(record.root_directory)
  );
  return {
    read: (baseBranch: string) =>
      readSandboxBranchChanges(sandbox, {
        cwd,
        baseBranch,
        signal: AbortSignal.timeout(20_000),
      }),
  };
}

const defaultDeps: RunChangesDeps = {
  loadRepo,
  githubToken,
  readGithub: readGithubBranchChanges,
  liveWorkspace,
};

function redactPatches(changes: BranchChanges): BranchChanges {
  return {
    ...changes,
    files: changes.files.map(
      (file): BranchChangedFile =>
        file.patch === undefined
          ? file
          : { ...file, patch: redactSecretsInText(file.patch) }
    ),
  };
}

/**
 * What a run changed. The live workspace wins when it is running, because it
 * includes uncommitted work; otherwise the pushed branch is compared on
 * GitHub. Every lookup is scoped to the run's owner. Patches have secrets
 * redacted before they leave this module.
 */
export async function loadRunChanges(
  run: RunChangesRun,
  overrides: Partial<RunChangesDeps> = {}
): Promise<RunChangesResult> {
  const deps = { ...defaultDeps, ...overrides };
  const userId = run.user_id;
  const branch = run.working_branch;
  const baseBranch = run.base_branch;
  if (!userId || !run.repo_id || !branch || !baseBranch)
    return { ok: false, reason: "no_branch" };
  const found = (
    source: RunChangesSource,
    changes: BranchChanges,
    webUrl?: string
  ) => ({
    ok: true as const,
    changes: {
      ...redactPatches(changes),
      source,
      baseBranch,
      branch,
      ...(webUrl ? { webUrl } : {}),
    },
  });

  if (run.sandbox_record_id) {
    try {
      const workspace = await deps.liveWorkspace({
        userId,
        repoId: run.repo_id,
        sandboxRecordId: run.sandbox_record_id,
        branch,
      });
      if (workspace)
        return found("workspace", await workspace.read(baseBranch));
    } catch (error) {
      // A workspace that stopped mid-read still has its pushed branch.
      console.warn("[slack-run-changes] workspace read failed", run.id, error);
    }
  }

  if (branch === baseBranch) return { ok: false, reason: "not_found" };
  const repo = await deps.loadRepo({ userId, repoId: run.repo_id });
  if (!repo) return { ok: false, reason: "not_found" };
  const token = await deps.githubToken(repo);
  if (!token) return { ok: false, reason: "not_found" };
  const changes = await deps.readGithub({
    repoFullName: repo.full_name,
    base: baseBranch,
    head: branch,
    token,
  });
  if (!changes) return { ok: false, reason: "not_found" };
  return found(
    "github",
    changes,
    `https://github.com/${repo.full_name}/compare/${encodeRef(baseBranch)}...${encodeRef(branch)}`
  );
}

/** Totals for a changes summary line. */
export function summarizeRunChanges(
  files: readonly Pick<BranchChangedFile, "additions" | "deletions">[]
) {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return { files: files.length, additions, deletions };
}
