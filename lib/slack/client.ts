import { supabaseAdmin } from "@/lib/supabase/admin";

const SLACK_API_BASE = "https://slack.com/api";

type SlackApiError = {
  ok: false;
  error?: string;
  needed?: string;
  provided?: string;
};

type SlackApiSuccess<T> = T & { ok: true };

export type SlackApiResponse<T> = SlackApiSuccess<T> | SlackApiError;

export type SlackPostMessageResult = {
  channel: string;
  ts: string;
  message?: { text?: string };
};

export type SlackPostEphemeralResult = {
  message_ts?: string;
};

export type SlackUpdateMessageResult = {
  channel: string;
  ts: string;
};

export type SlackOpenViewResult = {
  view?: { id?: string };
};

export type SlackThreadMessage = {
  type?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  files?: SlackThreadFile[];
};

export type SlackThreadFile = {
  id?: string;
  mimetype?: string;
  url_private_download?: string;
  name?: string;
  size?: number;
};

export type SlackUserInfo = {
  id: string;
  team_id?: string;
  name?: string;
  real_name?: string;
  profile?: {
    email?: string;
    real_name?: string;
    display_name?: string;
  };
  is_bot?: boolean;
};

/**
 * Resolve a workspace's bot token from Supabase Vault via the
 * `get_slack_bot_token` RPC. Returns `null` when the workspace isn't installed.
 */
export async function getSlackBotToken(teamId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("get_slack_bot_token", {
    p_team_id: teamId,
  });
  if (error) {
    throw new Error(`Failed to load Slack bot token: ${error.message}`);
  }
  if (typeof data === "string" && data.length > 0) return data;
  return null;
}

async function slackApiCall<T>(
  method: string,
  botToken: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<SlackApiSuccess<T>> {
  const response = await fetchImpl(`${SLACK_API_BASE}/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Slack ${method} HTTP ${response.status}`);
  }

  const json = (await response.json()) as SlackApiResponse<T>;
  if (!json.ok) {
    throw new Error(`Slack ${method} failed: ${json.error ?? "unknown_error"}`);
  }
  return json;
}

async function slackApiGet<T>(
  method: string,
  botToken: string,
  query: Record<string, string>,
  fetchImpl: typeof fetch = fetch
): Promise<SlackApiSuccess<T>> {
  const url = new URL(`${SLACK_API_BASE}/${method}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const response = await fetchImpl(url, {
    method: "GET",
    headers: { authorization: `Bearer ${botToken}` },
  });

  if (!response.ok) {
    throw new Error(`Slack ${method} HTTP ${response.status}`);
  }

  const json = (await response.json()) as SlackApiResponse<T>;
  if (!json.ok) {
    throw new Error(`Slack ${method} failed: ${json.error ?? "unknown_error"}`);
  }
  return json;
}

/** A Block Kit block — kept loose; callers are responsible for valid blocks. */
export type SlackBlock = Record<string, unknown>;

export type PostSlackMessageInput = {
  channel: string;
  text: string;
  thread_ts?: string;
  mrkdwn?: boolean;
  unfurl_links?: boolean;
  blocks?: SlackBlock[];
};

export async function postSlackMessage(
  botToken: string,
  input: PostSlackMessageInput,
  fetchImpl?: typeof fetch
): Promise<SlackPostMessageResult> {
  return slackApiCall<SlackPostMessageResult>(
    "chat.postMessage",
    botToken,
    {
      channel: input.channel,
      text: input.text,
      thread_ts: input.thread_ts,
      mrkdwn: input.mrkdwn ?? true,
      unfurl_links: input.unfurl_links ?? false,
      blocks: input.blocks,
    },
    fetchImpl
  );
}

export type PostSlackEphemeralInput = {
  channel: string;
  user: string;
  text: string;
  thread_ts?: string;
  mrkdwn?: boolean;
  blocks?: SlackBlock[];
};

export async function postSlackEphemeral(
  botToken: string,
  input: PostSlackEphemeralInput,
  fetchImpl?: typeof fetch
): Promise<SlackPostEphemeralResult> {
  return slackApiCall<SlackPostEphemeralResult>(
    "chat.postEphemeral",
    botToken,
    {
      channel: input.channel,
      user: input.user,
      text: input.text,
      thread_ts: input.thread_ts,
      mrkdwn: input.mrkdwn ?? true,
      blocks: input.blocks,
    },
    fetchImpl
  );
}

export type UpdateSlackMessageInput = {
  channel: string;
  ts: string;
  text: string;
  blocks?: SlackBlock[];
};

export async function updateSlackMessage(
  botToken: string,
  input: UpdateSlackMessageInput,
  fetchImpl?: typeof fetch
): Promise<SlackUpdateMessageResult> {
  return slackApiCall<SlackUpdateMessageResult>(
    "chat.update",
    botToken,
    input,
    fetchImpl
  );
}

export async function openSlackView(
  botToken: string,
  input: { trigger_id: string; view: Record<string, unknown> },
  fetchImpl?: typeof fetch
): Promise<SlackOpenViewResult> {
  return slackApiCall<SlackOpenViewResult>(
    "views.open",
    botToken,
    input,
    fetchImpl
  );
}

export async function getSlackThreadMessages(
  botToken: string,
  input: {
    channel: string;
    threadTs: string;
    latestTs?: string;
    limit?: number;
  },
  fetchImpl?: typeof fetch
): Promise<SlackThreadMessage[]> {
  const query: Record<string, string> = {
    channel: input.channel,
    ts: input.threadTs,
    limit: String(input.limit ?? 20),
  };
  if (input.latestTs) {
    query.latest = input.latestTs;
    query.inclusive = "false";
  }
  const json = await slackApiGet<{ messages?: SlackThreadMessage[] }>(
    "conversations.replies",
    botToken,
    query,
    fetchImpl
  );
  return Array.isArray(json.messages) ? json.messages : [];
}

export async function getSlackUserInfo(
  botToken: string,
  slackUserId: string,
  fetchImpl?: typeof fetch
): Promise<SlackUserInfo> {
  const json = await slackApiGet<{ user: SlackUserInfo }>(
    "users.info",
    botToken,
    { user: slackUserId },
    fetchImpl
  );
  return json.user;
}

/**
 * Strip leading `<@UXXX>` mention tokens from Slack message text so the agent
 * sees the user's actual instructions rather than a literal mention of itself.
 */
export function stripSlackMention(text: string): string {
  // Slack user IDs are conventionally uppercase but not contractually so —
  // accept either case to stay robust if that ever changes.
  return text.replace(/<@[A-Za-z0-9]+(?:\|[^>]*)?>\s*/g, "").trim();
}
