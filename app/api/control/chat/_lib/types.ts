import type { createAiCall } from "@/lib/interactive-runs";

/**
 * Message format accepted by the Control chat endpoint.
 * Clients send AI SDK UIMessages (`parts`); a plain `content` string/array is also accepted.
 */
export type ControlChatRequestMessage = {
  role?: string;
  content?: string | Array<{ type: string; text?: string }>;
  parts?: Array<{ type: string; text?: string }>;
};

/**
 * Request body for the Control chat endpoint.
 */
export type ControlChatRequestBody = {
  messages: ControlChatRequestMessage[];
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
  missionId?: string | null;
  missionTitle?: string | null;
};

/**
 * Scope identifiers for a Control chat run (used for event tracking).
 */
export type ControlChatRunScope = {
  conversationId: string | null;
  repoId: string | null;
  missionId: string | null;
};

/**
 * Metadata attached to a Control chat run for observability.
 */
export type ControlChatRunMetadata = {
  surface: "control";
  sandbox_id: string | null;
  repo: string | null;
  repo_owner: string | null;
  repo_name: string | null;
  repo_branch: string | null;
  team_id: string | null;
  mission_id: string | null;
};

/**
 * Active AI call record returned by createAiCall.
 */
export type ActiveControlCall = Awaited<ReturnType<typeof createAiCall>>;

/**
 * Error type with optional AI call attachment for startup failures.
 */
export type ControlStartupFailure = Error & {
  aiCall?: ActiveControlCall | null;
};
