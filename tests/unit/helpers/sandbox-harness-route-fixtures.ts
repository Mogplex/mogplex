import type { AiCall } from "../../../lib/types";
import type { Sandbox } from "@vercel/sandbox";

export function buildAiCall(overrides: Partial<AiCall> = {}): AiCall {
  return {
    id: "call-123",
    user_id: "user-123",
    type: "agent",
    model: "harness:codex",
    input_tokens: null,
    output_tokens: null,
    cache_read_input_tokens: null,
    cache_creation_input_tokens: null,
    reasoning_tokens: null,
    gateway_generation_id: null,
    cost_source: null,
    total_tokens: null,
    cost_usd: null,
    duration_ms: null,
    started_at: "2026-08-05T00:00:00.000Z",
    completed_at: null,
    status: "pending",
    error: null,
    conversation_id: null,
    job_run_id: null,
    repo_id: "repo-123",
    limit_claim_id: null,
    cancel_requested_at: null,
    control_state: "active",
    runtime_command_id: null,
    tool_calls_count: 0,
    tool_calls: [],
    metadata: {},
    ...overrides,
  };
}

export function parseSseEvents(body: string) {
  return body
    .split("\n\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(
      (entry) =>
        JSON.parse(entry.replace(/^data:\s*/, "")) as Record<string, unknown>
    );
}

export function buildHarnessGitDeliveryDeps() {
  return {
    getGithubAccessTokenForRepo: async () => "github-token",
    resolveSandboxGitAuthor: async () => ({
      name: "Mogplex Agent",
      email: "agent@example.com",
    }),
    ensureDevTools: async () => ({ ok: true, logs: "" }),
    syncTerminalRuntimeAuth: async () => ({ ok: true, logs: "" }),
    syncHarnessGitWorkspace: async (
      _sandbox: Sandbox,
      input: { baseBranch: string; workingBranch: string }
    ) => ({
      baseBranch: input.baseBranch,
      workingBranch: input.workingBranch,
      createdBranch: false,
    }),
    publishHarnessPullRequest: async () => ({
      pullRequestUrl: null,
      changed: false,
      autoCommittedFiles: [],
    }),
    updateSandboxWorkingBranch: async () => {},
  };
}

export async function loadSandboxHarnessRouteModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.VERCEL_PROJECT_ID ||= "prj_test0000000000000000000000";
  return import("../../../app/api/sandbox/[id]/harness/route");
}
