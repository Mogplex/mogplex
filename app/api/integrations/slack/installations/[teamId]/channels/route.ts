import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getSlackInstallationByTeamId } from "@/lib/slack/installations";
import { getSlackBotToken } from "@/lib/slack/client";

type SlackConversation = {
  id: string;
  name?: string;
  is_archived?: boolean;
  is_private?: boolean;
};

type SlackConversationsListResponse = {
  ok: boolean;
  error?: string;
  channels?: SlackConversation[];
  response_metadata?: { next_cursor?: string };
};

async function fetchSlackConversations(input: {
  botToken: string;
  cursor: string;
}): Promise<SlackConversationsListResponse | { httpStatus: number }> {
  const slackUrl = new URL("https://slack.com/api/conversations.list");
  slackUrl.searchParams.set("limit", "200");
  slackUrl.searchParams.set("exclude_archived", "true");
  slackUrl.searchParams.set("types", "public_channel,private_channel");
  if (input.cursor) slackUrl.searchParams.set("cursor", input.cursor);

  const response = await fetch(slackUrl, {
    headers: { authorization: `Bearer ${input.botToken}` },
  });
  if (!response.ok) return { httpStatus: response.status };
  return (await response.json()) as SlackConversationsListResponse;
}

async function authoriseChannelListRequest(teamId: string, userId: string) {
  const installation = await getSlackInstallationByTeamId(teamId);
  if (!installation) return { status: 404 as const, error: "not_found" };
  if (installation.installed_by_user_id !== userId) {
    return { status: 403 as const, error: "forbidden" };
  }
  const botToken = await getSlackBotToken(teamId);
  if (!botToken) return { status: 500 as const, error: "no_bot_token" };
  return { botToken };
}

/**
 * Proxy `conversations.list` for the channel-link UI. We expose only the
 * fields the UI needs and strip archived channels — Slack's API returns far
 * more than is useful here.
 *
 * Note: pulls the first page only. Workspaces with more than ~200 channels can
 * pass a `?cursor=` query in the future; the UI uses a typeahead anyway.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ teamId: string }> }
) {
  const userIdOrResponse = await requireUserId();
  if (userIdOrResponse instanceof Response) return userIdOrResponse;

  const { teamId } = await context.params;
  const auth = await authoriseChannelListRequest(teamId, userIdOrResponse);
  if ("status" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const cursor = new URL(request.url).searchParams.get("cursor") ?? "";
  const slackResponse = await fetchSlackConversations({
    botToken: auth.botToken,
    cursor,
  });

  if ("httpStatus" in slackResponse) {
    return NextResponse.json(
      { error: `slack_http_${slackResponse.httpStatus}` },
      { status: 502 }
    );
  }
  if (!slackResponse.ok) {
    return NextResponse.json(
      { error: slackResponse.error ?? "slack_error" },
      { status: 502 }
    );
  }

  const channels = (slackResponse.channels ?? [])
    .filter((channel) => !channel.is_archived && channel.id)
    .map((channel) => ({
      id: channel.id,
      name: channel.name ?? null,
      isPrivate: Boolean(channel.is_private),
    }));

  return NextResponse.json({
    channels,
    nextCursor: slackResponse.response_metadata?.next_cursor ?? null,
  });
}
