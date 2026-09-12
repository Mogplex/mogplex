/** Top-level DMs share one conversation; explicit DM replies keep their thread. */
export function getSlackConversationThreadTs(payload: {
  channelType: "im" | "mpim" | "channel" | "group";
  channelId: string;
  threadTs: string;
  messageTs: string;
}): string {
  if (payload.channelType === "im" && payload.threadTs === payload.messageTs)
    return payload.channelId;
  return payload.threadTs;
}
