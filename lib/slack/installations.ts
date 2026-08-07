import { supabaseAdmin } from "@/lib/supabase/admin";
import { escapePostgrestLikePattern } from "./slack-utils";

// ---------- core installation types ----------

export type SlackInstallationRow = {
  id: string;
  team_id: string;
  team_name: string | null;
  installed_by_user_id: string;
  bot_user_id: string;
  vault_bot_token_id: string;
  scopes: string[];
  authed_user_slack_id: string | null;
  repo_agent_enabled?: boolean | null;
  allowed_slack_user_ids?: string[] | null;
  monthly_repo_run_limit?: number | null;
  created_at: string;
  updated_at: string;
};

export type UpsertSlackInstallationInput = {
  teamId: string;
  teamName?: string | null;
  installedByUserId: string;
  botUserId: string;
  botToken: string;
  scopes: string[];
  authedUserSlackId?: string | null;
};

// ---------- core installation operations ----------

/**
 * Persist a Slack install. Delegates to the `upsert_slack_installation` RPC,
 * which stores the bot token in Supabase Vault and upserts the workspace row
 * pointing at that secret in a single transaction, so a failure can't leave an
 * orphaned secret or a dangling reference. Reinstalling the same workspace
 * replaces the secret and updates `installed_by_user_id` to whoever performed
 * the latest install.
 */
export async function upsertSlackInstallation(
  input: UpsertSlackInstallationInput
): Promise<SlackInstallationRow> {
  const { data, error } = await supabaseAdmin.rpc("upsert_slack_installation", {
    p_team_id: input.teamId,
    p_team_name: input.teamName ?? null,
    p_installed_by_user_id: input.installedByUserId,
    p_bot_user_id: input.botUserId,
    p_bot_token: input.botToken,
    p_scopes: input.scopes,
    p_authed_user_slack_id: input.authedUserSlackId ?? null,
  });

  if (error || !data) {
    throw new Error(
      `Failed to upsert slack installation: ${error?.message ?? "no row returned"}`
    );
  }

  return data as SlackInstallationRow;
}

export async function getSlackInstallationByTeamId(
  teamId: string
): Promise<SlackInstallationRow | null> {
  const { data, error } = await supabaseAdmin
    .from("slack_installations")
    .select("*")
    .eq("team_id", teamId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load slack_installation: ${error.message}`);
  }
  return (data ?? null) as SlackInstallationRow | null;
}

export async function listSlackInstallationsForUser(
  userId: string
): Promise<SlackInstallationRow[]> {
  const { data, error } = await supabaseAdmin
    .from("slack_installations")
    .select("*")
    .eq("installed_by_user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list slack_installations: ${error.message}`);
  }
  return (data ?? []) as SlackInstallationRow[];
}

/**
 * Remove a Slack install. Delegates to the `delete_slack_installation` RPC,
 * which deletes the workspace row (scoped to the installer) and its Vault
 * secret in a single transaction, so a failure can't leave a dangling secret
 * reference. A no-op (nothing to delete) is not an error.
 */
export async function deleteSlackInstallation(input: {
  teamId: string;
  userId: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.rpc("delete_slack_installation", {
    p_team_id: input.teamId,
    p_user_id: input.userId,
  });

  if (error) {
    throw new Error(`Failed to delete slack installation: ${error.message}`);
  }
}

// ---------- installation policy ----------

export async function updateSlackInstallationPolicy(input: {
  teamId: string;
  userId: string;
  repoAgentEnabled?: boolean;
  allowedSlackUserIds?: string[] | null;
  monthlyRepoRunLimit?: number | null;
}): Promise<SlackInstallationRow | null> {
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof input.repoAgentEnabled === "boolean") {
    update.repo_agent_enabled = input.repoAgentEnabled;
  }
  if ("allowedSlackUserIds" in input) {
    update.allowed_slack_user_ids = input.allowedSlackUserIds;
  }
  if ("monthlyRepoRunLimit" in input) {
    update.monthly_repo_run_limit = input.monthlyRepoRunLimit;
  }

  const { data, error } = await supabaseAdmin
    .from("slack_installations")
    .update(update)
    .eq("team_id", input.teamId)
    .eq("installed_by_user_id", input.userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to update slack installation policy: ${error.message}`
    );
  }
  return (data ?? null) as SlackInstallationRow | null;
}

// ---------- profile lookup ----------

/**
 * Look up a Mogplex profile by case-insensitive email match. Used to bind a
 * Slack user (whose email we pull from `users.info`) to an existing profile.
 */
export async function findProfileIdByEmail(
  email: string
): Promise<string | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", escapePostgrestLikePattern(trimmed))
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find profile by email: ${error.message}`);
  }
  return (data?.id as string | undefined) ?? null;
}

// ---------- re-exports from extracted modules ----------

export {
  isPostgresUniqueViolation,
  escapePostgrestLikePattern,
} from "./slack-utils";

export {
  type SlackChannelLinkRow,
  getSlackChannelLink,
  listSlackChannelLinks,
  createSlackChannelLink,
  deleteSlackChannelLink,
} from "./channel-links";

export {
  type SlackThreadConversationRow,
  SlackThreadConversationAlreadyBoundError,
  isSlackThreadConversationUniqueConflict,
  getSlackThreadConversation,
  bindSlackThreadToConversation,
} from "./thread-conversations";

export {
  type SlackUserMappingRow,
  type SlackUserLinkToken,
  getSlackUserMapping,
  upsertSlackUserMapping,
  isExplicitSlackUserMapping,
  createSlackUserLinkToken,
  consumeSlackUserLinkToken,
} from "./user-mappings";
