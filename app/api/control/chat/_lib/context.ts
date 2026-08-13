import { releaseLimitClaim } from "@/lib/request-limits";
import { resolveUserDefaultModelId } from "@/lib/models/default-model";
import type { GatewayCallContext } from "@/lib/models/gateway-provider-routing";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  ControlChatRequestBody,
  ControlChatRunScope,
  ControlChatRunMetadata,
} from "./types";
import { listWorktrees } from "@/lib/worktrees/service";
import type {
  ResourceDecisionSource,
  ResourceRejectionReason,
} from "@/lib/agents/orchestrator/resource-telemetry";

export {
  resolveControlPromptSandboxContext,
  resolveControlPromptSandboxes,
  resolveControlToolSandboxId,
  resolveSelectedControlSandboxId,
  type ControlPromptSandboxContext,
} from "./sandbox-context";

/**
 * Extract scope identifiers from the request body for event tracking.
 */
export function getControlChatRunScope(
  body: ControlChatRequestBody
): ControlChatRunScope {
  return {
    conversationId: body.conversationId || null,
    repoId: body.repoId || null,
    missionId: body.missionId || null,
  };
}

type ControlPromptWorktreeSession = {
  user_id: string;
  repo_id: string | null;
  orchestration_run_id: string | null;
};

type ControlPromptWorktreeDeps = {
  loadSession: (input: {
    conversationId: string;
    userId: string;
  }) => Promise<ControlPromptWorktreeSession | null>;
  listWorktrees: typeof listWorktrees;
  warn?: (message: string, context: Record<string, unknown>) => void;
};

const defaultControlPromptWorktreeDeps: ControlPromptWorktreeDeps = {
  async loadSession(input) {
    const { data, error } = await supabaseAdmin
      .from("control_sessions")
      .select("user_id, repo_id, orchestration_run_id")
      .eq("id", input.conversationId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },
  listWorktrees,
  warn: (message, context) => console.warn(message, context),
};

export type ControlPromptWorktreeContext = {
  controlSessionId: string | null;
  orchestrationRunId: string | null;
  decisionSource: ResourceDecisionSource;
  rejectionReason: ResourceRejectionReason | null;
  worktrees: Array<{
    id: string;
    taskId: string;
    branch: string;
    status: string;
    sandboxId: string;
    checkoutPath: string;
    agentId?: string;
  }>;
};

function resolveWorktreeSession(
  session: ControlPromptWorktreeSession | null,
  userId: string,
  repoId: string
):
  | { ok: true; runId: string }
  | { ok: false; reason: ResourceRejectionReason } {
  if (!session) return { ok: false, reason: "session_not_found" };
  if (session.user_id !== userId || session.repo_id !== repoId) {
    return { ok: false, reason: "repo_mismatch" };
  }
  return session.orchestration_run_id
    ? { ok: true, runId: session.orchestration_run_id }
    : { ok: false, reason: "mission_not_linked" };
}

function nullable<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

function presentPromptWorktree(
  worktree: Awaited<ReturnType<typeof listWorktrees>>[number]
) {
  return {
    id: worktree.id,
    taskId: worktree.task_id,
    branch: worktree.branch_name,
    status: worktree.status,
    sandboxId: worktree.sandbox_id,
    checkoutPath: worktree.checkout_path,
    ...(worktree.agent_id ? { agentId: worktree.agent_id } : {}),
  };
}

function worktreeRequestPreflight(body: ControlChatRequestBody) {
  if (!body.conversationId || !body.repoId) {
    return { rejectionReason: null };
  }
  if (body.missionId && body.missionId !== body.conversationId) {
    return { rejectionReason: "mission_mismatch" as const };
  }
  return null;
}

/** Load worktrees only through the owned Control session and its linked run. */
export async function resolveControlPromptWorktrees(
  userId: string,
  body: ControlChatRequestBody,
  deps: ControlPromptWorktreeDeps = defaultControlPromptWorktreeDeps
): Promise<ControlPromptWorktreeContext> {
  const empty = {
    controlSessionId: null,
    orchestrationRunId: null,
    decisionSource: "none" as const,
    rejectionReason: null,
    worktrees: [],
  };
  const warn = deps.warn ?? (() => {});
  const preflight = worktreeRequestPreflight(body);
  if (preflight) return { ...empty, ...preflight };
  const conversationId = body.conversationId!;
  const repoId = body.repoId!;
  try {
    const session = await deps.loadSession({
      conversationId,
      userId,
    });
    const sessionResolution = resolveWorktreeSession(session, userId, repoId);
    if (!sessionResolution.ok) {
      return { ...empty, rejectionReason: sessionResolution.reason };
    }
    const worktrees = await deps.listWorktrees({
      userId,
      runId: sessionResolution.runId,
      repoId,
    });
    return {
      controlSessionId: conversationId,
      orchestrationRunId: sessionResolution.runId,
      decisionSource: "owned_control_session",
      rejectionReason: null,
      worktrees: worktrees
        .filter((worktree) => worktree.status !== "archived")
        .map(presentPromptWorktree),
    };
  } catch (error) {
    warn("[control] worktree prompt context unavailable", {
      conversationId,
      repoId,
      error,
    });
    return { ...empty, rejectionReason: "worktree_lookup_failed" };
  }
}

/**
 * Build metadata for observability from request body and team context.
 */
export function buildControlChatRunMetadata(
  body: ControlChatRequestBody,
  teamId: string | null
): ControlChatRunMetadata {
  return {
    surface: "control",
    sandbox_id: null,
    sandbox_hint_id: nullable(body.sandboxId),
    sandbox_runtime_id: null,
    sandbox_selection_source: null,
    sandbox_rejection_reason: null,
    repo: nullable(body.repoFullName),
    repo_owner: nullable(body.repoOwner),
    repo_name: nullable(body.repoName),
    repo_branch: nullable(body.repoBranch),
    team_id: teamId,
    mission_id: null,
    mission_hint_id: nullable(body.missionId),
    orchestration_run_id: null,
    scope: nullable(body.scope),
    target: nullable(body.target),
    permissions: nullable(body.permissions),
    mode: nullable(body.mode),
  };
}

/**
 * Resolve the model ID to use for this request.
 * Uses the requested model if provided, otherwise falls back to user's default.
 */
export async function resolveControlChatModelId(
  userId: string,
  requestedModel?: string | null
): Promise<string> {
  if (requestedModel) return requestedModel;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("default_model")
    .eq("id", userId)
    .single();
  return resolveUserDefaultModelId(userId, profile?.default_model);
}

/**
 * Build gateway context for model routing with appropriate tags.
 */
export function buildControlGatewayContext(
  userId: string,
  body: ControlChatRequestBody
): GatewayCallContext {
  const tags = ["surface:control"];
  if (body.repoFullName) tags.push(`repo:${body.repoFullName}`);
  if (body.conversationId) tags.push(`conversation:${body.conversationId}`);
  if (body.missionId) tags.push(`mission:${body.missionId}`);

  return {
    userId,
    tags,
    caching: "auto",
  };
}

/**
 * Resolve GitHub access token for a repo if the user has access.
 */
export async function resolveGithubTokenForRepo(
  userId: string,
  repoId: string | null | undefined
): Promise<string | null> {
  if (!repoId) return null;

  try {
    const { getGithubAccessTokenForRepo } = await import("@/lib/github-access");
    const { data: repo } = await supabaseAdmin
      .from("repos")
      .select("user_id, github_installation_id")
      .eq("id", repoId)
      .eq("user_id", userId)
      .single();

    if (!repo) return null;
    return await getGithubAccessTokenForRepo(repo);
  } catch {
    return null;
  }
}

/**
 * Release a rate limit claim if one was acquired.
 */
export async function releaseLimitClaimIfNeeded(
  userId: string,
  limitClaimId: string | null
) {
  if (!limitClaimId) return;
  await releaseLimitClaim({
    userId,
    routeKey: "chat",
    claimId: limitClaimId,
  });
}
