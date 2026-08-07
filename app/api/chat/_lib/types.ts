import type { requireUserId } from "@/lib/auth";
import type { enforceChatLimits } from "@/lib/request-limits";
import type { createAiCall } from "@/lib/interactive-runs";

export const MEMORY_CONTEXT_TIMEOUT_MS = 3000;
export const SESSION_MEMORY_DUPLICATE_WINDOW_MS = 60_000;
export const SESSION_MEMORY_RETENTION_LIMIT = 50;
export const SESSION_MEMORY_PRUNE_SCAN_LIMIT = 75;

export type ChatRequestMessage = {
  role?: string;
  content?: string | Array<{ type: string; text?: string }>;
};

export type ChatRequestBody = {
  messages: ChatRequestMessage[];
  model?: string | null;
  enableTools?: boolean;
  sandboxId?: string | null;
  repoFullName?: string | null;
  repoOwner?: string | null;
  repoName?: string | null;
  repoBranch?: string | null;
  repoBaseBranch?: string | null;
  conversationId?: string | null;
  repoId?: string | null;
  workspaceSessionId?: string | null;
};

export type ChatRunScope = {
  conversationId: string | null;
  repoId: string | null;
};

export type ChatRunMetadata = {
  sandbox_id: string | null;
  repo: string | null;
  repo_owner: string | null;
  repo_name: string | null;
  repo_branch: string | null;
  team_id: string | null;
};

export type ChatMemoryContext = {
  rules?: Array<{ content: string }>;
  memories?: Array<{ content: string }>;
} | null;

export type ActiveChatCall = Awaited<ReturnType<typeof createAiCall>>;

export type ChatStartupFailure = Error & {
  aiCall?: ActiveChatCall | null;
};

export type ChatPostDeps = {
  requireUserId: typeof requireUserId;
  enforceChatLimits: typeof enforceChatLimits;
};

export function getChatRunScope(body: ChatRequestBody): ChatRunScope {
  return {
    conversationId: body.conversationId || null,
    repoId: body.repoId || null,
  };
}

export function buildChatRunMetadata(
  body: ChatRequestBody,
  teamId: string | null
): ChatRunMetadata {
  return {
    sandbox_id: body.sandboxId ?? null,
    repo: body.repoFullName ?? null,
    repo_owner: body.repoOwner ?? null,
    repo_name: body.repoName ?? null,
    repo_branch: body.repoBranch ?? null,
    team_id: teamId,
  };
}
