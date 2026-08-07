import { supabaseAdmin } from "@/lib/supabase/admin";

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
