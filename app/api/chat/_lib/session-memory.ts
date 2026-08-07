import type { ChatRequestBody } from "./types";
import {
  SESSION_MEMORY_DUPLICATE_WINDOW_MS,
  SESSION_MEMORY_RETENTION_LIMIT,
  SESSION_MEMORY_PRUNE_SCAN_LIMIT,
} from "./types";
import { extractLatestUserText, getChatMemoryScope } from "./memory";

export async function persistChatSessionMemory(
  userId: string,
  body: ChatRequestBody
) {
  const content = extractLatestUserText(body.messages);
  if (!content.trim()) return;

  try {
    const {
      addToLane,
      buildLaneScopedMetadata,
      createMemoriesClient,
      forgetMemory,
      getMemoryScopeForLane,
      listByLane,
    } = await import("@/lib/memories-client");

    const client = createMemoriesClient(userId);
    const memoryScope = getMemoryScopeForLane(
      "session",
      getChatMemoryScope(body)
    );
    const recentRows = await listByLane(
      client,
      "session",
      SESSION_MEMORY_PRUNE_SCAN_LIMIT,
      memoryScope
    );
    const pruneOverflowRows = async (startIndex: number) => {
      const overflowRows = recentRows.slice(startIndex);
      if (overflowRows.length === 0) return;
      await Promise.allSettled(
        overflowRows.map((row) => forgetMemory(client, row.id))
      );
    };
    const latestRow = recentRows[0];
    if (latestRow?.content === content) {
      const createdAtMs = Date.parse(latestRow.created_at);
      if (
        Number.isFinite(createdAtMs) &&
        Date.now() - createdAtMs < SESSION_MEMORY_DUPLICATE_WINDOW_MS
      ) {
        // Best-effort dedupe only. Concurrent identical submissions can still
        // race past this check, but the scoped retention cap bounds the fallout.
        await pruneOverflowRows(SESSION_MEMORY_RETENTION_LIMIT);
        return;
      }
    }

    await addToLane(
      client,
      "session",
      content,
      buildLaneScopedMetadata(
        "session",
        {
          role: "user",
        },
        {
          ...getChatMemoryScope(body),
          source: "native-chat",
          agent: "native",
        }
      ),
      { skipEmbedding: true }
    );
    await pruneOverflowRows(SESSION_MEMORY_RETENTION_LIMIT - 1);
  } catch (error) {
    console.warn("[chat] failed to persist session memory", error);
  }
}
