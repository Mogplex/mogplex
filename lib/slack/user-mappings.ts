import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isPostgresUniqueViolation } from "./slack-utils";

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

// ---------- slack-user link tokens ----------

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
