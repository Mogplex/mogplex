/** A request and all its replies share one conversation in every channel type. */
export function getSlackConversationThreadTs(payload: {
  channelType: "im" | "mpim" | "channel" | "group";
  channelId: string;
  threadTs: string;
  messageTs: string;
}): string {
  return payload.threadTs;
}
