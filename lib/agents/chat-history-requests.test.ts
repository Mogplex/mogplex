import { expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  buildChatHistoryRequests,
  loadChatHistoryCalls,
} from "./chat-history-requests";

function message(index: number): UIMessage {
  return {
    id: `message-${index}`,
    role: "assistant",
    metadata: {
      ai_call_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    },
    parts: [
      {
        type: "tool-bash",
        toolCallId: `tool-${index}`,
        state: "input-available",
        input: {},
      },
    ],
  };
}

it("batches every exact recovery candidate, deduplicates, and preserves conversation scope", () => {
  const messages = Array.from({ length: 205 }, (_, index) => message(index));
  const urls = buildChatHistoryRequests(
    [...messages, messages[0]],
    "conversation/with space"
  );
  expect(urls).toHaveLength(3);
  const batches = urls.map(
    (url) => new URL(url, "http://localhost").searchParams
  );
  expect(
    batches.map((params) => params.get("call_ids")?.split(",").length)
  ).toEqual([100, 100, 5]);
  expect(
    batches.flatMap((params) => params.get("call_ids")!.split(","))
  ).toEqual(
    messages.map(
      (entry) => (entry.metadata as { ai_call_id: string }).ai_call_id
    )
  );
  for (const params of batches) {
    expect(params.get("conversation_id")).toBe("conversation/with space");
    expect(params.get("type")).toBe("chat");
    expect(params.get("limit")).toBe("100");
  }
  expect(buildChatHistoryRequests([], "conversation")).toEqual([]);
  expect(
    buildChatHistoryRequests(
      [{ ...message(1), parts: [{ type: "text", text: "done" }] }],
      "conversation"
    )
  ).toEqual([]);
});

it("reads each finite batch once without executing a chat or treating missing rows as terminal", async () => {
  const urls = buildChatHistoryRequests([message(1)], "conversation");
  const requested: string[] = [];
  const calls = await loadChatHistoryCalls(urls, async (url) => {
    requested.push(String(url));
    return Response.json({ calls: [] });
  });
  expect(calls).toEqual([]);
  expect(requested).toEqual(urls);
});

it("combines exact batch results and rejects an unsuccessful lookup", async () => {
  const calls = await loadChatHistoryCalls(["/first", "/second"], async (url) =>
    Response.json({ calls: [{ id: String(url) }] })
  );
  expect(calls.map((call) => call.id)).toEqual(["/first", "/second"]);
  await expect(
    loadChatHistoryCalls(
      ["/failed"],
      async () => new Response(null, { status: 503 })
    )
  ).rejects.toThrow("Unable to load saved chat run status");
});
