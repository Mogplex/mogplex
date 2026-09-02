/**
 * Resolve the Slack thread key a conversational event binds to.
 *
 * Slack does not thread one-to-one DMs: each top-level DM message arrives
 * with its own `ts` and no `thread_ts`. Keying on the message timestamp would
 * start a fresh Mogplex conversation for every DM, so the bot forgets the
 * previous turn. A DM channel is therefore one continuous conversation keyed
 * on the channel itself. Channels, private groups, and group DMs keep Slack's
 * thread semantics.
 */
export function getSlackConversationThreadTs(payload: {
  channelType: "im" | "mpim" | "channel" | "group";
  channelId: string;
  threadTs: string;
}): string {
  if (payload.channelType === "im") return payload.channelId;
  return payload.threadTs;
}
