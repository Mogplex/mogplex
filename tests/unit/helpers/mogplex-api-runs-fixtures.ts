import type { AiCall, AiCallEvent } from "../../../lib/types";
import type {
  ExternalAgentRunRow,
  StartMogplexApiRunDeps,
} from "../../../lib/mogplex-api/runs";

export async function loadRunsRoute() {
  // Keep these defaults stable across same-process node:test imports; route
  // modules only need syntactically valid Supabase env for dependency injection.
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../app/api/v1/mogplex/runs/route");
}

export async function loadRunDetailRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../app/api/v1/mogplex/runs/[runId]/route");
}

export async function loadRunEventsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../app/api/v1/mogplex/runs/[runId]/events/route");
}

export async function loadRunCancelRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../app/api/v1/mogplex/runs/[runId]/cancel/route");
}

export function buildRunRow(
  overrides: Partial<ExternalAgentRunRow> = {}
): ExternalAgentRunRow {
  return {
    id: "run-1",
    user_id: "user-123",
    repo_id: "repo-1",
    ai_call_id: "call-1",
    sandbox_record_id: "sandbox-record-1",
    sandbox_id: "sbx_123",
    worktree_id: null,
    idempotency_key: "idem-1",
    request_hash: "hash-1",
    harness: "codex",
    status: "pending",
    prompt: "Fix the tests",
    base_branch: "main",
    working_branch: "mogplex/external/run",
    create_branch: false,
    root_directory: null,
    conversation_id: null,
    workspace_session_id: null,
    mode: null,
    runtime_provider: null,
    runtime_run_id: null,
    error: null,
    metadata: {},
    created_at: "2026-04-28T00:00:00.000Z",
    updated_at: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

export function buildUser() {
  return {
    userId: "user-123",
    keyId: "key-1",
    scopes: ["read", "write"],
  };
}

export function buildAiCall(overrides: Partial<AiCall> = {}): AiCall {
  return {
    id: "call-1",
    user_id: "user-123",
    type: "agent",
    model: "harness:codex",
    status: "pending",
    started_at: "2026-04-28T00:00:00.000Z",
    completed_at: null,
    error: null,
    conversation_id: null,
    repo_id: "repo-1",
    metadata: {},
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
    job_run_id: null,
    limit_claim_id: null,
    cancel_requested_at: null,
    control_state: "active",
    runtime_command_id: null,
    tool_calls_count: 0,
    tool_calls: [],
    ...overrides,
  };
}

export function buildAiCallEvent(
  overrides: Partial<AiCallEvent> = {}
): AiCallEvent {
  return {
    id: "event-1",
    ai_call_id: "call-1",
    user_id: "user-123",
    conversation_id: null,
    repo_id: "repo-1",
    event_type: "started",
    tool_name: null,
    message: "Run started",
    payload: {},
    created_at: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

export function buildStartDeps(
  overrides: Partial<StartMogplexApiRunDeps> = {}
): StartMogplexApiRunDeps {
  return {
    loadOwnedRepo: async () => ({
      id: "repo-1",
      full_name: "webrenew/mogplex",
      default_branch: "main",
      root_directory: null,
    }),
    loadRunByIdempotencyKey: async () => null,
    loadRunById: async () => null,
    findActiveSandbox: async () => null,
    loadOwnedWorktree: async () => null,
    createAiCall: async () => buildAiCall(),
    markAiCallFailed: async () => {},
    insertRun: async (input) =>
      buildRunRow({
        request_hash: input.requestHash,
        create_branch: input.normalized.createBranch,
        root_directory: input.normalized.rootDirectory,
        working_branch: input.normalized.workingBranch,
      }),
    queueRun: async () => ({
      runtimeProvider: "trigger",
      runtimeRunId: "trigger-run-1",
    }),
    markRunQueued: async (input) =>
      buildRunRow({
        runtime_provider: input.runtimeProvider,
        runtime_run_id: input.runtimeRunId,
      }),
    markRunFailed: async (input) =>
      buildRunRow({
        status: "failed",
        error: input.error,
      }),
    appendAcceptedEvent: async () => {},
    ...overrides,
  };
}

export { type AiCall, type AiCallEvent } from "../../../lib/types";

export {
  type StartMogplexApiRunDeps,
  type ExternalAgentRunRow,
} from "../../../lib/mogplex-api/runs";
