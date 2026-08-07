import type {
  SlackChannelLinkRow,
  SlackInstallationRow,
} from "@/lib/slack/installations";
import type {
  ConversationRow,
  SlackChannelLinkState,
  SlackEventTaskDeps,
  SlackEventTaskPayload,
} from "./types";

export async function resolveRepoAgentChannelLink(input: {
  deps: Pick<SlackEventTaskDeps, "getChannelLink">;
  installation: SlackInstallationRow;
  payload: SlackEventTaskPayload;
  userText: string;
}): Promise<SlackChannelLinkRow | null> {
  if (input.payload.eventType !== "app_mention") return null;
  if (!hasSlackUserInput(input.payload, input.userText)) return null;
  return input.deps.getChannelLink({
    installationId: input.installation.id,
    channelId: input.payload.channelId,
  });
}

export function resolveSlackChannelLinkState(input: {
  payload: SlackEventTaskPayload;
  userText: string;
  channelLink: SlackChannelLinkRow | null;
}): SlackChannelLinkState {
  if (isSlackDirectConversation(input.payload)) return "direct_message";
  if (
    input.payload.eventType !== "app_mention" ||
    !hasSlackUserInput(input.payload, input.userText)
  ) {
    return "unknown";
  }
  return input.channelLink ? "linked" : "unlinked";
}

export function resolveSlackConversationLinkState(input: {
  payload: SlackEventTaskPayload;
  channelLinkState: SlackChannelLinkState;
}): SlackChannelLinkState {
  if (input.channelLinkState !== "unknown") return input.channelLinkState;
  if (
    input.payload.eventType === "message" &&
    !isSlackDirectConversation(input.payload)
  ) {
    return "bound_thread";
  }
  return "unknown";
}

export function requiresExistingSlackConversation(
  payload: SlackEventTaskPayload
) {
  return payload.eventType === "message" && !isSlackDirectConversation(payload);
}

export function isSlackDirectConversation(payload: SlackEventTaskPayload) {
  return payload.channelType === "im" || payload.channelType === "mpim";
}

export function isUninvokedSlackGroupMessage(
  payload: SlackEventTaskPayload,
  botUserId: string
) {
  if (payload.channelType !== "mpim") return false;
  if (payload.eventType === "app_mention") return false;

  for (const match of payload.text.matchAll(/<@([A-Za-z0-9]+)(?:\|[^>]*)?>/g)) {
    if (match[1] === botUserId) return false;
  }
  return true;
}

export async function loadBoundSlackGroupConversation(input: {
  deps: Pick<SlackEventTaskDeps, "loadBoundConversation">;
  installation: SlackInstallationRow;
  payload: SlackEventTaskPayload;
}): Promise<ConversationRow | null | undefined> {
  if (
    !isUninvokedSlackGroupMessage(input.payload, input.installation.bot_user_id)
  ) {
    return undefined;
  }
  return input.deps.loadBoundConversation({
    installationId: input.installation.id,
    channelId: input.payload.channelId,
    threadTs: input.payload.threadTs,
  });
}

export function getSlackReplyThreadTs(payload: SlackEventTaskPayload) {
  if (payload.channelType === "im") return undefined;
  return payload.threadTs;
}

export function hasSlackUserInput(
  payload: SlackEventTaskPayload,
  userText: string
): boolean {
  return (
    userText.length > 0 ||
    (payload.attachments?.length ?? 0) > 0 ||
    (payload.attachmentNotices?.length ?? 0) > 0
  );
}
