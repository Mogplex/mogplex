import { releaseLimitClaim } from "@/lib/request-limits";
import { resolveUserDefaultModelId } from "@/lib/models/default-model";
import type { GatewayCallContext } from "@/lib/models/gateway-provider-routing";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  loadOwnedSandboxRouteRecord,
  type LoadedSandboxRouteRecord,
  type SandboxRouteFailure,
} from "@/lib/sandbox/route-context";
import type {
  ControlChatRequestBody,
  ControlChatRunScope,
  ControlChatRunMetadata,
} from "./types";
import { listWorktrees } from "@/lib/worktrees/service";

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

type ControlPromptSandboxRecord = {
  id: string;
  sandbox_id: string;
  repo_id: string;
  working_branch: string;
  status: string;
};

type ControlPromptSandboxDeps = {
  loadSandboxRecord: (
    request: Request,
    sandboxId: string,
    options: { select: string }
  ) => Promise<
    LoadedSandboxRouteRecord<ControlPromptSandboxRecord> | SandboxRouteFailure
  >;
  warn?: (message: string, context: Record<string, unknown>) => void;
};

const defaultControlPromptSandboxDeps: ControlPromptSandboxDeps = {
  loadSandboxRecord: (request, sandboxId, options) =>
    loadOwnedSandboxRouteRecord<ControlPromptSandboxRecord>(
      request,
      sandboxId,
      options
    ),
  warn: (message, context) => console.warn(message, context),
};

type ControlPromptWorktreeDeps = {
  loadSession: (input: { conversationId: string; userId: string }) => Promise<{
    user_id: string;
    repo_id: string | null;
    orchestration_run_id: string | null;
  } | null>;
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
  orchestrationRunId: string | null;
  worktrees: Array<{
    id: string;
    branch: string;
    status: string;
    sandboxId: string;
    checkoutPath: string;
    agentId?: string;
  }>;
};

/** Load worktrees only through the owned Control session and its linked run. */
export async function resolveControlPromptWorktrees(
  userId: string,
  body: ControlChatRequestBody,
  deps: ControlPromptWorktreeDeps = defaultControlPromptWorktreeDeps
): Promise<ControlPromptWorktreeContext> {
  const empty = { orchestrationRunId: null, worktrees: [] };
  if (!body.conversationId || !body.repoId) return empty;
  try {
    const session = await deps.loadSession({
      conversationId: body.conversationId,
      userId,
    });
    if (
      session?.user_id !== userId ||
      session.repo_id !== body.repoId ||
      !session.orchestration_run_id
    ) {
      return empty;
    }
    const worktrees = await deps.listWorktrees({
      userId,
      runId: session.orchestration_run_id,
      repoId: body.repoId,
    });
    return {
      orchestrationRunId: session.orchestration_run_id,
      worktrees: worktrees
        .filter((worktree) => worktree.status !== "archived")
        .map((worktree) => ({
          id: worktree.id,
          branch: worktree.branch_name,
          status: worktree.status,
          sandboxId: worktree.sandbox_id,
          checkoutPath: worktree.checkout_path,
          ...(worktree.agent_id ? { agentId: worktree.agent_id } : {}),
        })),
    };
  } catch (error) {
    deps.warn?.("[control] worktree prompt context unavailable", {
      conversationId: body.conversationId,
      repoId: body.repoId,
      error,
    });
    return empty;
  }
}

/**
 * Load the selected sandbox from server-owned state before adding it to the
 * system prompt. A client-provided sandbox id is only a lookup hint; it must
 * never manufacture sandbox or worktree context for the orchestrator.
 */
export async function resolveControlPromptSandboxes(
  request: Request,
  body: ControlChatRequestBody,
  deps: ControlPromptSandboxDeps = defaultControlPromptSandboxDeps
): Promise<Array<{ id: string; branch: string; status: string }>> {
  if (!body.sandboxId || !body.repoId) return [];

  let loaded:
    | LoadedSandboxRouteRecord<ControlPromptSandboxRecord>
    | SandboxRouteFailure;
  try {
    loaded = await deps.loadSandboxRecord(request, body.sandboxId, {
      select: "id, sandbox_id, repo_id, working_branch, status",
    });
  } catch (error) {
    deps.warn?.("[control] sandbox prompt context lookup threw", {
      sandboxId: body.sandboxId,
      repoId: body.repoId,
      error,
    });
    return [];
  }

  if (!loaded.ok) {
    deps.warn?.("[control] sandbox prompt context unavailable", {
      sandboxId: body.sandboxId,
      repoId: body.repoId,
      status: loaded.status,
      error: loaded.error,
    });
    return [];
  }
  if (loaded.record.repo_id !== body.repoId) {
    deps.warn?.("[control] sandbox prompt context repo mismatch", {
      sandboxId: body.sandboxId,
      repoId: body.repoId,
      sandboxRepoId: loaded.record.repo_id,
    });
    return [];
  }

  return [
    {
      id: loaded.record.id,
      branch: loaded.record.working_branch,
      status: loaded.record.status,
    },
  ];
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
    sandbox_id: body.sandboxId ?? null,
    repo: body.repoFullName ?? null,
    repo_owner: body.repoOwner ?? null,
    repo_name: body.repoName ?? null,
    repo_branch: body.repoBranch ?? null,
    team_id: teamId,
    mission_id: body.missionId ?? null,
    scope: body.scope ?? null,
    target: body.target ?? null,
    permissions: body.permissions ?? null,
    mode: body.mode ?? null,
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
