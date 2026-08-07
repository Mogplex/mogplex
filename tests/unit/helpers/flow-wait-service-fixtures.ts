process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "service-role-key";

export type FetchHandler = (request: {
  url: string;
  method: string;
  body: string | null;
}) => Response | Promise<Response>;

export async function withFetch<T>(
  handler: FetchHandler,
  fn: () => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body
          ? String(init.body)
          : null;
    return handler({ url, method, body });
  }) as typeof globalThis.fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

export async function loadWaitService() {
  return import("../../../lib/flows/wait-service");
}

export function createLabelWaitCandidate(overrides: {
  id: string;
  jobRunId?: string;
  labelName: string;
  resumeToken: string;
  prOnly?: boolean;
  repoId?: string | null;
}) {
  return {
    id: overrides.id,
    user_id: "user-1",
    job_run_id: overrides.jobRunId ?? "job-1",
    flow_id: "flow-1",
    installation_id: 99 as number | null,
    repo_id: (overrides.repoId ?? null) as string | null,
    node_id: "await-1",
    wait_kind: "github_label_added" as const,
    wait_config: {
      kind: "github_label_added" as const,
      labelName: overrides.labelName,
      prOnly: overrides.prOnly ?? true,
    },
    resume_token: overrides.resumeToken,
  };
}

export function createCommentWaitCandidate(overrides: {
  id: string;
  bodyContains?: string;
  authorLogin?: string;
  expectedIssueNumber?: number | null;
  prOnly?: boolean;
  matchTriggerIssue?: boolean;
  resumeToken: string;
}) {
  return {
    id: overrides.id,
    user_id: "u",
    job_run_id: "j1",
    flow_id: "f",
    installation_id: 99 as number | null,
    repo_id: "repo-1" as string | null,
    node_id: "n1",
    wait_kind: "github_comment_added" as const,
    wait_config: {
      kind: "github_comment_added" as const,
      bodyContains: overrides.bodyContains ?? "",
      authorLogin: overrides.authorLogin ?? "",
      prOnly: overrides.prOnly ?? true,
      matchTriggerIssue: overrides.matchTriggerIssue ?? true,
      expectedIssueNumber: overrides.expectedIssueNumber ?? null,
    },
    resume_token: overrides.resumeToken,
  };
}

export function createCiWaitCandidate(overrides: {
  id: string;
  workflowName: string;
  conclusion: "success" | "failure";
  expectedSha: string;
  resumeToken: string;
}) {
  return {
    id: overrides.id,
    user_id: "u",
    job_run_id: "j1",
    flow_id: "f",
    installation_id: 99 as number | null,
    repo_id: "repo-1" as string | null,
    node_id: "n1",
    wait_kind: "ci_workflow_completed" as const,
    wait_config: {
      kind: "ci_workflow_completed" as const,
      workflowName: overrides.workflowName,
      conclusion: overrides.conclusion,
      matchTriggerSha: true,
      expectedSha: overrides.expectedSha,
    },
    resume_token: overrides.resumeToken,
  };
}

export function createPreviewWaitCandidate(overrides: {
  id: string;
  environment: string;
  expectedSha: string;
  resumeToken: string;
}) {
  return {
    id: overrides.id,
    user_id: "u",
    job_run_id: "j1",
    flow_id: "f",
    installation_id: 99 as number | null,
    repo_id: "repo-1" as string | null,
    node_id: "n1",
    wait_kind: "vercel_preview_ready" as const,
    wait_config: {
      kind: "vercel_preview_ready" as const,
      environment: overrides.environment,
      matchTriggerSha: true,
      expectedSha: overrides.expectedSha,
    },
    resume_token: overrides.resumeToken,
  };
}
