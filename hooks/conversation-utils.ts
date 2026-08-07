import type { Message } from "./conversation-types";

const syncChains = new Map<string, Promise<void>>();

export async function queueConversationSync(
  paneId: string,
  task: () => Promise<void>
) {
  const previous = syncChains.get(paneId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);

  syncChains.set(paneId, next);

  try {
    await next;
  } finally {
    if (syncChains.get(paneId) === next) {
      syncChains.delete(paneId);
    }
  }
}

export function messagesEqual(a: Message[], b: Message[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function extractTitle(messages: Message[]): string | undefined {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser?.parts) return undefined;
  const text = firstUser.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
  if (!text) return undefined;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}
