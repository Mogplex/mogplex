import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOW_ASSISTANT_GRAPH_STATE_PART_TYPE,
  FLOW_ASSISTANT_RESULT_DATA_TYPE,
  sanitizeFlowAssistantMessagesForRequest,
  shouldContinueFlowAssistantAfterToolCall,
} from "../../lib/flows/assistant-chat-payload";
import type { UIMessage } from "ai";

function message(input: Partial<UIMessage>): UIMessage {
  return {
    id: input.id ?? crypto.randomUUID(),
    role: input.role ?? "assistant",
    parts: input.parts ?? [],
    metadata: input.metadata,
  } as UIMessage;
}

test("sanitizeFlowAssistantMessagesForRequest strips historical graph payloads", () => {
  const graph = { nodes: [], edges: [] };
  const messages = [
    message({
      id: "assistant-1",
      parts: [
        { type: "text", text: "old" },
        {
          type: FLOW_ASSISTANT_GRAPH_STATE_PART_TYPE,
          toolCallId: "tool-1",
          state: "output-available",
          input: {},
          output: { graph },
        },
        {
          type: FLOW_ASSISTANT_RESULT_DATA_TYPE,
          data: { graph, valid: true, finalized: false, summary: null },
        },
      ],
      metadata: { flowAssistant: { graph } },
    }),
    message({
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "next" }],
    }),
  ];

  const sanitized = sanitizeFlowAssistantMessagesForRequest(messages);
  assert.equal(sanitized[0].metadata, undefined);
  assert.deepEqual(sanitized[0].parts, [{ type: "text", text: "old" }]);
  assert.deepEqual(sanitized[1].parts, [{ type: "text", text: "next" }]);
});

test("sanitizeFlowAssistantMessagesForRequest keeps active graph tool continuation", () => {
  const graph = { nodes: [], edges: [] };
  const messages = [
    message({
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "edit" }],
    }),
    message({
      id: "assistant-1",
      parts: [
        {
          type: FLOW_ASSISTANT_GRAPH_STATE_PART_TYPE,
          toolCallId: "tool-1",
          state: "output-available",
          input: {},
          output: { graph },
        },
      ],
    }),
  ];

  const sanitized = sanitizeFlowAssistantMessagesForRequest(messages);
  assert.deepEqual(sanitized[1].parts, messages[1].parts);
});

test("sanitizeFlowAssistantMessagesForRequest drops in-progress graph tool parts", () => {
  const messages = [
    message({
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "edit" }],
    }),
    message({
      id: "assistant-1",
      parts: [
        {
          type: FLOW_ASSISTANT_GRAPH_STATE_PART_TYPE,
          toolCallId: "tool-1",
          state: "input-streaming",
          input: {},
        },
      ],
    }),
  ];

  const sanitized = sanitizeFlowAssistantMessagesForRequest(messages);
  assert.deepEqual(sanitized[1].parts, []);
});

test("shouldContinueFlowAssistantAfterToolCall only resumes getGraphState calls", () => {
  const graph = { nodes: [], edges: [] };

  assert.equal(
    shouldContinueFlowAssistantAfterToolCall({
      messages: [
        message({
          id: "assistant-1",
          parts: [
            { type: "step-start" },
            {
              type: FLOW_ASSISTANT_GRAPH_STATE_PART_TYPE,
              toolCallId: "tool-1",
              state: "output-available",
              input: {},
              output: { graph },
            },
          ],
        }),
      ],
    }),
    true
  );

  assert.equal(
    shouldContinueFlowAssistantAfterToolCall({
      messages: [
        message({
          id: "assistant-2",
          parts: [
            { type: "step-start" },
            {
              type: "tool-setStart",
              toolCallId: "tool-2",
              state: "output-available",
              input: {},
              output: { id: "start" },
            },
          ],
        }),
      ],
    }),
    false
  );
});
