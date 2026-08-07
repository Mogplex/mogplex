import { createHash } from "node:crypto";
import {
  COMPACTION_CHAR_BUDGET,
  COMPACTION_KEEP_RECENT_MESSAGES,
  type CompactableAgentMessage,
} from "./types";

/**
 * Pure planning half of conversation-level compaction: when to compact, where
 * to split, and how to fingerprint the covered prefix so a persisted
 * checkpoint can be reused instead of re-summarizing every turn.
 */

export type CompactionSplit<Message extends CompactableAgentMessage> =
  | { compact: false }
  | {
      compact: true;
      /** Leading system messages — policy, kept verbatim, never compacted. */
      leadingSystem: Message[];
      covered: Message[];
      recent: Message[];
    };

/**
 * Rough size of a message in characters. JSON length covers every part shape
 * (text, tool inputs/outputs, files) without knowing the schema; the goal is a
 * stable trigger signal, not an exact token count.
 */
export function estimateMessageChars(message: unknown): number {
  try {
    return JSON.stringify(message)?.length ?? 0;
  } catch {
    return 0;
  }
}

export function estimateMessagesChars(messages: readonly unknown[]): number {
  let total = 0;
  for (const message of messages) total += estimateMessageChars(message);
  return total;
}

/**
 * Extract the human-readable text of a message regardless of shape:
 * `content` as a string, `content` as a parts array, or a UIMessage `parts`
 * array. Non-text parts contribute nothing here.
 */
export function extractMessageText(message: CompactableAgentMessage): string {
  if (typeof message.content === "string") return message.content;
  const parts = Array.isArray(message.parts)
    ? message.parts
    : Array.isArray(message.content)
      ? message.content
      : [];
  const texts: string[] = [];
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      texts.push((part as { text: string }).text);
    }
  }
  return texts.join("\n");
}

/**
 * Decide whether to compact and where to split. Leading system messages are
 * never compacted (they are policy, not conversation). The retained window
 * must open with a user message: providers reject histories where the first
 * turn after the handoff replies to a message the model can no longer see.
 */
export function planCompactionSplit<Message extends CompactableAgentMessage>(
  messages: readonly Message[],
  options?: { charBudget?: number; keepRecent?: number }
): CompactionSplit<Message> {
  const charBudget = options?.charBudget ?? COMPACTION_CHAR_BUDGET;
  const keepRecent = options?.keepRecent ?? COMPACTION_KEEP_RECENT_MESSAGES;

  if (estimateMessagesChars(messages) <= charBudget) return { compact: false };

  let systemCount = 0;
  while (
    systemCount < messages.length &&
    messages[systemCount].role === "system"
  ) {
    systemCount++;
  }
  const conversational = messages.length - systemCount;
  if (conversational <= keepRecent) return { compact: false };

  let splitIndex = messages.length - keepRecent;
  while (splitIndex < messages.length && messages[splitIndex].role !== "user") {
    splitIndex += 1;
  }
  if (splitIndex >= messages.length) {
    // No user message in the tail; keep the original window rather than
    // summarizing everything away.
    splitIndex = messages.length - keepRecent;
  }
  if (splitIndex <= systemCount) return { compact: false };

  return {
    compact: true,
    leadingSystem: messages.slice(0, systemCount) as Message[],
    covered: messages.slice(systemCount, splitIndex) as Message[],
    recent: messages.slice(splitIndex) as Message[],
  };
}

/**
 * Stable fingerprint of a message prefix. Built from roles and extracted text
 * (plus ids when present) rather than raw JSON so cosmetic metadata the client
 * adds later does not invalidate a persisted checkpoint.
 */
export function hashMessagePrefix(
  messages: readonly CompactableAgentMessage[]
): string {
  const hash = createHash("sha256");
  for (const message of messages) {
    hash.update(message.role);
    hash.update("\u0000");
    if (typeof message.id === "string") hash.update(message.id);
    hash.update("\u0000");
    hash.update(extractMessageText(message));
    hash.update("\u0001");
  }
  return hash.digest("hex");
}

/**
 * If the incoming history (after any leading system messages) starts with the
 * exact prefix a persisted checkpoint covered, the checkpoint replaces that
 * prefix. Returns the leading system messages and the retained suffix, or
 * null when the prefix no longer matches (edited history → recompact).
 */
export function matchCheckpointPrefix<Message extends CompactableAgentMessage>(
  messages: readonly Message[],
  stored: { prefixHash: string; coveredMessageCount: number }
): { leadingSystem: Message[]; suffix: Message[] } | null {
  const { coveredMessageCount, prefixHash } = stored;
  let systemCount = 0;
  while (
    systemCount < messages.length &&
    messages[systemCount].role === "system"
  ) {
    systemCount++;
  }
  if (
    coveredMessageCount <= 0 ||
    systemCount + coveredMessageCount > messages.length
  ) {
    return null;
  }
  const prefix = messages.slice(systemCount, systemCount + coveredMessageCount);
  if (hashMessagePrefix(prefix) !== prefixHash) return null;
  return {
    leadingSystem: messages.slice(0, systemCount) as Message[],
    suffix: messages.slice(systemCount + coveredMessageCount) as Message[],
  };
}
