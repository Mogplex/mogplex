import type { MemoryScope } from "@/lib/memories-client";
import type {
  ChatRequestMessage,
  ChatRequestBody,
  ChatMemoryContext,
} from "./types";
import { MEMORY_CONTEXT_TIMEOUT_MS } from "./types";

export function buildMemoryQueryFromMessages(messages: ChatRequestMessage[]) {
  const latestUserText = extractLatestUserText(messages, 200);
  return latestUserText || "general context";
}

export function extractLatestUserText(
  messages: ChatRequestMessage[],
  maxLength = 2_000
) {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const rawContent = lastUserMessage?.parts ?? lastUserMessage?.content;

  if (typeof rawContent === "string") {
    return rawContent.slice(0, maxLength);
  }

  if (Array.isArray(rawContent)) {
    return rawContent
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join(" ")
      .slice(0, maxLength);
  }

  return "";
}

export function buildMemoryContextSection(context: ChatMemoryContext) {
  if (context?.rules?.length) {
    const sectionLines: string[] = [
      "## Rules",
      ...context.rules.map((rule) => `- ${rule.content}`),
    ];
    if (context.memories?.length) {
      sectionLines.push(
        "## Relevant Memories",
        ...context.memories.map((memory) => `- ${memory.content}`)
      );
    }
    return sectionLines.join("\n");
  }

  if (context?.memories?.length) {
    return [
      "## Relevant Memories",
      ...context.memories.map((memory) => `- ${memory.content}`),
    ].join("\n");
  }

  return null;
}

export function getChatMemoryScope(
  body: ChatRequestBody
): MemoryScope | undefined {
  const scope: MemoryScope = {};

  if (body.repoId) scope.repoId = body.repoId;
  if (body.workspaceSessionId) {
    scope.workspaceSessionId = body.workspaceSessionId;
  }
  if (body.conversationId) scope.conversationId = body.conversationId;
  if (body.sandboxId) scope.sandboxId = body.sandboxId;

  return Object.keys(scope).length > 0 ? scope : undefined;
}

export async function loadMemoryContext(
  userId: string,
  messages: ChatRequestMessage[],
  scope?: MemoryScope
): Promise<ChatMemoryContext> {
  try {
    const { loadMemoryContextNative } = await import("@/lib/memories-client");
    return Promise.race([
      loadMemoryContextNative(
        userId,
        buildMemoryQueryFromMessages(messages),
        10,
        undefined,
        scope
      ),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), MEMORY_CONTEXT_TIMEOUT_MS)
      ),
    ]);
  } catch (error) {
    // The timeout leg of the Promise.race resolves null rather than
    // rejecting, so anything landing here is an unexpected failure worth
    // logging at error level for ops visibility.
    console.error(
      "Memory context injection failed:",
      error instanceof Error ? (error.stack ?? error.message) : error
    );
    return null;
  }
}

export async function buildChatMemorySuffix(
  userId: string,
  body: ChatRequestBody
): Promise<string | null> {
  const memoryContext = await loadMemoryContext(
    userId,
    body.messages,
    getChatMemoryScope(body)
  );
  const memorySection = buildMemoryContextSection(memoryContext);
  return memorySection
    ? `<memory-context>\n${memorySection}\n</memory-context>`
    : null;
}
