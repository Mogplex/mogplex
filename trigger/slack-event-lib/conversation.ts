import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  bindSlackThreadToConversation,
  getSlackThreadConversation,
  SlackThreadConversationAlreadyBoundError,
  type SlackInstallationRow,
} from "@/lib/slack/installations";
import type { RunChatAgentMessage } from "@/lib/agents/run-chat";
import type { ConversationRow, SlackEventTaskDeps } from "./types";

export class SlackConversationPersistConflictError extends Error {
  constructor(readonly conversation: ConversationRow) {
    super("Conversation changed before Slack thread history could be saved");
    this.name = "SlackConversationPersistConflictError";
  }
}

async function loadConversationById(conversationId: string) {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("id, user_id, messages, model, title, updated_at")
    .eq("id", conversationId)
    .single();
  if (error || !data) {
    throw new Error(
      `Failed to load linked conversation ${conversationId}: ${
        error?.message ?? "missing row"
      }`
    );
  }
  return data as ConversationRow;
}

async function safeDeleteConversation(conversationId: string) {
  const { error } = await supabaseAdmin
    .from("conversations")
    .delete()
    .eq("id", conversationId);
  if (error) {
    console.warn("[slack-event] failed to clean up unused conversation", {
      conversationId,
      error,
    });
  }
}

export async function loadBoundConversation(input: {
  installationId: string;
  channelId: string;
  threadTs: string;
}) {
  const existing = await getSlackThreadConversation({
    installationId: input.installationId,
    channelId: input.channelId,
    threadTs: input.threadTs,
  });

  if (!existing) return null;
  return loadConversationById(existing.conversation_id);
}

export async function defaultLoadOrCreateConversation(input: {
  installation: SlackInstallationRow;
  channelId: string;
  threadTs: string;
  mogplexUserId: string;
  requireExisting?: boolean;
}): Promise<ConversationRow | null> {
  const bound = await loadBoundConversation({
    installationId: input.installation.id,
    channelId: input.channelId,
    threadTs: input.threadTs,
  });
  if (bound) return bound;
  if (input.requireExisting) return null;

  const conversationId = crypto.randomUUID();
  const title = `Slack: ${input.channelId}`;
  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("conversations")
    .insert({
      id: conversationId,
      user_id: input.mogplexUserId,
      messages: [],
      title,
      updated_at: now,
    })
    .select("id, user_id, messages, model, title, updated_at")
    .single();
  if (insertError || !inserted) {
    throw new Error(
      `Failed to create Slack-backed conversation: ${
        insertError?.message ?? "no row"
      }`
    );
  }

  try {
    await bindSlackThreadToConversation({
      installationId: input.installation.id,
      channelId: input.channelId,
      threadTs: input.threadTs,
      conversationId,
    });
  } catch (error) {
    await safeDeleteConversation(conversationId);
    if (!(error instanceof SlackThreadConversationAlreadyBoundError)) {
      throw error;
    }
    const winner = await loadBoundConversation({
      installationId: input.installation.id,
      channelId: input.channelId,
      threadTs: input.threadTs,
    });
    if (!winner) {
      throw new Error("Slack thread binding conflict resolved without a row", {
        cause: error,
      });
    }
    return winner;
  }

  return inserted as ConversationRow;
}

export async function defaultPersistConversation(input: {
  conversationId: string;
  userId: string;
  messages: RunChatAgentMessage[];
  expectedUpdatedAt?: string | null;
}) {
  if (!input.expectedUpdatedAt) {
    throw new Error(
      "Missing expected_updated_at for Slack conversation update"
    );
  }

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .update({
      messages: input.messages,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.conversationId)
    .eq("user_id", input.userId)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to persist conversation: ${error.message}`);
  }
  if (!data) {
    throw new SlackConversationPersistConflictError(
      await loadConversationById(input.conversationId)
    );
  }
}

export async function persistConversationTurn(input: {
  deps: SlackEventTaskDeps;
  conversation: ConversationRow;
  turnMessages: RunChatAgentMessage[];
}) {
  let latest = input.conversation;
  let lastConflict: SlackConversationPersistConflictError | null = null;

  // Optimistic-lock retry: a concurrent turn on the same thread can bump
  // `updated_at` between our read and write. Three attempts comfortably covers
  // realistic contention (Slack thread events are already serialized by the
  // task's concurrencyKey, so a collision here is rare) without risking a
  // runaway loop if something keeps writing.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await input.deps.persistConversation({
        conversationId: latest.id,
        userId: latest.user_id,
        messages: [...latest.messages, ...input.turnMessages],
        expectedUpdatedAt: latest.updated_at,
      });
      return;
    } catch (error) {
      if (!(error instanceof SlackConversationPersistConflictError)) {
        throw error;
      }
      lastConflict = error;
      latest = error.conversation;
    }
  }

  if (lastConflict) throw lastConflict;
  throw new Error("Failed to persist Slack conversation turn");
}
