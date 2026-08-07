/**
 * Default number of trailing messages to retain when windowing a conversation
 * history before sending it to the model. ~40 messages ≈ 20 user/assistant
 * turns — generous enough to preserve useful context without letting a long
 * Slack thread grow the prompt unbounded.
 */
export const DEFAULT_MESSAGE_WINDOW = 40;

/**
 * Trim a conversation history to its most recent `maxMessages` entries before
 * it is handed to the agent. Any leading `system` messages are always kept
 * (they carry instructions, not conversational turns) and the trailing window
 * is taken from the remaining messages.
 *
 * Pure and side-effect free; returns the original array unchanged when it is
 * already within the limit.
 */
export function windowMessages<Message extends { role: string }>(
  messages: Message[],
  maxMessages: number = DEFAULT_MESSAGE_WINDOW
): Message[] {
  if (messages.length <= maxMessages) return messages;

  let systemCount = 0;
  while (
    systemCount < messages.length &&
    messages[systemCount].role === "system"
  ) {
    systemCount++;
  }

  const leadingSystem = messages.slice(0, systemCount);
  const rest = messages.slice(systemCount);
  return [...leadingSystem, ...rest.slice(-maxMessages)];
}
