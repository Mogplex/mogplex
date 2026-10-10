import { API_RUN_BRANCH_PATTERN } from "@/lib/flows/automation-inputs";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  defaultRunArtifactDeps,
  readCommittedArtifact,
  RunArtifactError,
  runArtifactPathSchema,
  type RunArtifactDeps,
} from "./run-artifacts";

type AutomationJobRun = {
  status: string;
  metadata: Record<string, unknown> | null;
};

export type AutomationRunArtifactDeps = Pick<
  RunArtifactDeps,
  "loadRepo" | "githubJson"
> & {
  loadJobRun: (input: {
    userId: string;
    automationId: string;
    jobRunId: string;
  }) => Promise<AutomationJobRun | null>;
};

async function loadOwnedJobRun(input: {
  userId: string;
  automationId: string;
  jobRunId: string;
}): Promise<AutomationJobRun | null> {
  const { data: flow, error: flowError } = await supabaseAdmin
    .from("flows")
    .select("id")
    .eq("id", input.automationId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (flowError) throw new Error(flowError.message);
  if (!flow) return null;
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .select("status, metadata")
    .eq("id", input.jobRunId)
    .eq("flow_id", input.automationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as AutomationJobRun | null;
}

const defaults: AutomationRunArtifactDeps = {
  loadJobRun: loadOwnedJobRun,
  loadRepo: defaultRunArtifactDeps.loadRepo,
  githubJson: defaultRunArtifactDeps.githubJson,
};

/**
 * Read an explicit output an API-triggered automation run committed to its
 * own branch. The branch and repository come from the run's trigger record,
 * never from the caller. Automation runs record no terminal commit, so the
 * read is at the branch tip; the returned `commitSha` names what was read.
 */
export async function loadAutomationRunArtifact(
  input: {
    userId: string;
    automationId: string;
    jobRunId: string;
    path: string;
  },
  overrides: Partial<AutomationRunArtifactDeps> = {}
) {
  const deps = { ...defaults, ...overrides };
  const parsedPath = runArtifactPathSchema.safeParse(input.path);
  if (!parsedPath.success)
    throw new RunArtifactError(400, "Use a JSON file in .mogplex/artifacts");
  const path = parsedPath.data;
  const run = await deps.loadJobRun(input);
  if (!run) throw new RunArtifactError(404, "Automation run not found");
  const branch = run.metadata?.working_branch;
  const repoId = run.metadata?.repo_id;
  if (
    typeof branch !== "string" ||
    !API_RUN_BRANCH_PATTERN.test(branch) ||
    typeof repoId !== "string"
  )
    throw new RunArtifactError(
      409,
      "Artifacts are available only for API-triggered automation runs"
    );
  if (run.status !== "success")
    throw new RunArtifactError(
      409,
      "Artifacts require a successful automation run"
    );
  const { commitSha, content } = await readCommittedArtifact(
    { userId: input.userId, repoId, ref: branch, pinned: false, path },
    deps
  );
  return {
    automationId: input.automationId,
    jobRunId: input.jobRunId,
    repoId,
    path,
    branch,
    commitSha,
    pinned: false,
    content,
  };
}
