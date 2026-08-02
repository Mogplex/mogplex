import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

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

// ---------- channel → repo routing ----------

export type SlackChannelLinkRow = {
  id: string;
  slack_installation_id: string;
  channel_id: string;
  channel_name: string | null;
  repo_id: string;
  created_by_user_id: string;
  created_at: string;
};

export async function getSlackChannelLink(input: {
  installationId: string;
  channelId: string;
}): Promise<SlackChannelLinkRow | null> {
  const { data, error } = await supabaseAdmin
    .from("slack_channel_links")
    .select("*")
    .eq("slack_installation_id", input.installationId)
    .eq("channel_id", input.channelId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load slack_channel_link: ${error.message}`);
  }
  return (data ?? null) as SlackChannelLinkRow | null;
}

export async function listSlackChannelLinks(
  installationId: string
): Promise<SlackChannelLinkRow[]> {
  const { data, error } = await supabaseAdmin
    .from("slack_channel_links")
    .select("*")
    .eq("slack_installation_id", installationId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list slack_channel_links: ${error.message}`);
  }
  return (data ?? []) as SlackChannelLinkRow[];
}

export async function createSlackChannelLink(input: {
  installationId: string;
  channelId: string;
  channelName: string | null;
  repoId: string;
  createdByUserId: string;
}): Promise<SlackChannelLinkRow> {
  const { data, error } = await supabaseAdmin
    .from("slack_channel_links")
    .insert({
      slack_installation_id: input.installationId,
      channel_id: input.channelId,
      channel_name: input.channelName,
      repo_id: input.repoId,
      created_by_user_id: input.createdByUserId,
    })
    .select("*")
    .single();

  if (error || !data) {
    const wrapped = new Error(
      `Failed to create slack_channel_link: ${error?.message ?? "no row"}`,
      { cause: error }
    ) as Error & { code?: string };
    wrapped.code = error?.code;
    throw wrapped;
  }
  return data as SlackChannelLinkRow;
}

export function isPostgresUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeCode = (error as { code?: unknown }).code;
  if (maybeCode === "23505") return true;
  return isPostgresUniqueViolation((error as { cause?: unknown }).cause);
}

export async function deleteSlackChannelLink(input: {
  linkId: string;
  installationId: string;
  createdByUserId: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("slack_channel_links")
    .delete()
    .eq("id", input.linkId)
    .eq("slack_installation_id", input.installationId)
    .eq("created_by_user_id", input.createdByUserId);

  if (error) {
    throw new Error(`Failed to delete slack_channel_link: ${error.message}`);
  }
}

// ---------- thread → conversation continuity ----------

export type SlackThreadConversationRow = {
  id: string;
  slack_installation_id: string;
  channel_id: string;
  thread_ts: string;
  conversation_id: string;
  created_at: string;
};

export class SlackThreadConversationAlreadyBoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlackThreadConversationAlreadyBoundError";
  }
}

export function isSlackThreadConversationUniqueConflict(error: {
  code?: string;
  message?: string;
}) {
  return (
    error.code === "23505" ||
    error.message?.includes("slack_thread_conversations_unique") === true
  );
}

/**
 * Look up the Mogplex conversation a Slack thread is bound to (if any).
 * Slice C uses this so subsequent thread replies continue the same conversation.
 */
export async function getSlackThreadConversation(input: {
  installationId: string;
  channelId: string;
  threadTs: string;
}): Promise<SlackThreadConversationRow | null> {
  const { data, error } = await supabaseAdmin
    .from("slack_thread_conversations")
    .select("*")
    .eq("slack_installation_id", input.installationId)
    .eq("channel_id", input.channelId)
    .eq("thread_ts", input.threadTs)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load slack_thread_conversation: ${error.message}`
    );
  }
  return (data ?? null) as SlackThreadConversationRow | null;
}

export async function bindSlackThreadToConversation(input: {
  installationId: string;
  channelId: string;
  threadTs: string;
  conversationId: string;
}): Promise<SlackThreadConversationRow> {
  const { data, error } = await supabaseAdmin
    .from("slack_thread_conversations")
    .insert({
      slack_installation_id: input.installationId,
      channel_id: input.channelId,
      thread_ts: input.threadTs,
      conversation_id: input.conversationId,
    })
    .select("*")
    .single();

  if (error || !data) {
    if (error && isSlackThreadConversationUniqueConflict(error)) {
      throw new SlackThreadConversationAlreadyBoundError(
        "Slack thread is already bound to a conversation"
      );
    }
    throw new Error(
      `Failed to bind slack_thread_conversation: ${error?.message ?? "no row"}`
    );
  }
  return data as SlackThreadConversationRow;
}

// ---------- slack-user ↔ mogplex-profile mapping ----------

export type SlackUserMappingRow = {
  id: string;
  slack_installation_id: string;
  slack_user_id: string;
  mogplex_user_id: string | null;
  slack_email: string | null;
  matched_at: string | null;
  link_status?: "legacy_email" | "explicit" | null;
  linked_at?: string | null;
  linked_by_user_id?: string | null;
  created_at: string;
};

export async function getSlackUserMapping(
  input: {
    installationId: string;
    slackUserId: string;
  },
  client: Pick<typeof supabaseAdmin, "from"> = supabaseAdmin
): Promise<SlackUserMappingRow | null> {
  const { data, error } = await client
    .from("slack_user_mappings")
    .select("*")
    .eq("slack_installation_id", input.installationId)
    .eq("slack_user_id", input.slackUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load slack_user_mapping: ${error.message}`);
  }
  return (data ?? null) as SlackUserMappingRow | null;
}

export async function upsertSlackUserMapping(
  input: {
    installationId: string;
    slackUserId: string;
    mogplexUserId: string | null;
    slackEmail: string | null;
  },
  client: Pick<typeof supabaseAdmin, "from"> = supabaseAdmin
): Promise<SlackUserMappingRow> {
  const matchedAt = input.mogplexUserId ? new Date().toISOString() : null;
  const insertPayload = {
    slack_installation_id: input.installationId,
    slack_user_id: input.slackUserId,
    mogplex_user_id: input.mogplexUserId,
    slack_email: input.slackEmail,
    matched_at: matchedAt,
    link_status: "legacy_email",
  };

  const { data: inserted, error: insertError } = await client
    .from("slack_user_mappings")
    .insert(insertPayload)
    .select("*")
    .single();

  if (!insertError && inserted) {
    return inserted as SlackUserMappingRow;
  }
  if (insertError && !isPostgresUniqueViolation(insertError)) {
    throw new Error(
      `Failed to insert slack_user_mapping: ${insertError.message}`
    );
  }

  const { data: updated, error: updateError } = await client
    .from("slack_user_mappings")
    .update({
      mogplex_user_id: input.mogplexUserId,
      slack_email: input.slackEmail,
      matched_at: matchedAt,
      link_status: "legacy_email",
    })
    .eq("slack_installation_id", input.installationId)
    .eq("slack_user_id", input.slackUserId)
    .neq("link_status", "explicit")
    .select("*")
    .maybeSingle();

  if (updateError) {
    throw new Error(
      `Failed to update slack_user_mapping: ${updateError.message}`
    );
  }
  if (updated) return updated as SlackUserMappingRow;

  const existing = await getSlackUserMapping(
    {
      installationId: input.installationId,
      slackUserId: input.slackUserId,
    },
    client
  );
  if (existing) {
    if (isExplicitSlackUserMapping(existing)) {
      console.info(
        "[slack-installations] legacy_email update skipped; returning explicit Slack user mapping",
        {
          installationId: input.installationId,
          slackUserId: input.slackUserId,
        }
      );
    } else {
      console.debug(
        "[slack-installations] legacy_email update skipped; returning existing Slack user mapping",
        {
          installationId: input.installationId,
          slackUserId: input.slackUserId,
          linkStatus: existing.link_status ?? null,
        }
      );
    }
    return existing;
  }

  throw new Error("Failed to upsert slack_user_mapping: no row");
}

export function isExplicitSlackUserMapping(
  row: SlackUserMappingRow | null | undefined
): row is SlackUserMappingRow & { mogplex_user_id: string } {
  return row?.link_status === "explicit" && Boolean(row.mogplex_user_id);
}

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

export type SlackUserLinkToken = {
  token: string;
  expiresAt: string;
};

function hashSlackUserLinkToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSlackUserLinkToken(
  input: {
    installationId: string;
    teamId: string;
    slackUserId: string;
    ttlMs?: number;
  },
  client: Pick<typeof supabaseAdmin, "from"> = supabaseAdmin
): Promise<SlackUserLinkToken> {
  const nowIso = new Date().toISOString();
  const { error: revokeError } = await client
    .from("slack_user_link_tokens")
    .update({ consumed_at: nowIso })
    .eq("slack_installation_id", input.installationId)
    .eq("slack_user_id", input.slackUserId)
    .is("consumed_at", null)
    .gt("expires_at", nowIso);

  if (revokeError) {
    throw new Error(
      `Failed to revoke slack user link token: ${revokeError.message}`
    );
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + (input.ttlMs ?? 15 * 60 * 1000)
  ).toISOString();
  const { error } = await client.from("slack_user_link_tokens").insert({
    slack_installation_id: input.installationId,
    team_id: input.teamId,
    slack_user_id: input.slackUserId,
    token_hash: hashSlackUserLinkToken(token),
    expires_at: expiresAt,
  });

  if (error) {
    throw new Error(`Failed to create slack user link token: ${error.message}`);
  }
  return { token, expiresAt };
}

export async function consumeSlackUserLinkToken(input: {
  token: string;
  mogplexUserId: string;
}): Promise<SlackUserMappingRow | null> {
  if (!input.token) {
    throw new Error("consumeSlackUserLinkToken called with empty token");
  }
  const { data, error } = await supabaseAdmin.rpc(
    "consume_slack_user_link_token",
    {
      p_token_hash: hashSlackUserLinkToken(input.token),
      p_mogplex_user_id: input.mogplexUserId,
    }
  );

  if (error) {
    throw new Error(
      `Failed to consume slack user link token: ${error.message}`
    );
  }
  return (data ?? null) as SlackUserMappingRow | null;
}

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

export function escapePostgrestLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
