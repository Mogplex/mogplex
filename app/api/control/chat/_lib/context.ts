import { releaseLimitClaim } from "@/lib/request-limits";
import { resolveUserDefaultModelId } from "@/lib/models/default-model";
import type { GatewayCallContext } from "@/lib/models/gateway-provider-routing";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  ControlChatRequestBody,
  ControlChatRunScope,
  ControlChatRunMetadata,
} from "./types";

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
