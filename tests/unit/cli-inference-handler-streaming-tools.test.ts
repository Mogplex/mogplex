import assert from "node:assert/strict";
import test from "node:test";
import {
  loadHandler,
  parseSsePayloads,
} from "./helpers/cli-inference-handler-fixtures";

test("createOpenAiChatCompletionStream keeps a single tool-call id across streamed tool chunks", async () => {
  const { createOpenAiChatCompletionStream } = await loadHandler();
  const outcomes: unknown[] = [];

  const response = createOpenAiChatCompletionStream({
    createResult: () => ({
      fullStream: (async function* streamChunks() {
        yield {
          type: "tool-input-start",
          toolCallId: "call_1",
          toolName: "lookup_case",
        };
        yield {
          type: "tool-input-delta",
          toolCallId: "call_1",
          inputTextDelta: '{"query":"hel',
        };
        yield {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "lookup_case",
          input: { query: "hello" },
        };
        yield {
          type: "finish",
          finishReason: "tool-calls",
          totalUsage: { inputTokens: 12, outputTokens: 3 },
        };
      })(),
    }),
    responseId: "chatcmpl_test",
    created: 123,
    modelId: "openai/gpt-5.4",
    onOutcome(outcome) {
      outcomes.push(outcome);
    },
  });

  const payloads = parseSsePayloads(await response.text());
  assert.deepEqual(payloads.at(-1), "[DONE]");

  const jsonPayloads = payloads
    .slice(0, -1)
    .map((payload) => JSON.parse(payload) as Record<string, unknown>);
  assert.equal(jsonPayloads.length, 4);

  assert.deepEqual(jsonPayloads[0], {
    id: "chatcmpl_test",
    object: "chat.completion.chunk",
    created: 123,
    model: "openai/gpt-5.4",
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  });

  assert.deepEqual(jsonPayloads[1], {
    id: "chatcmpl_test",
    object: "chat.completion.chunk",
    created: 123,
    model: "openai/gpt-5.4",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "lookup_case", arguments: "" },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  });

  assert.deepEqual(jsonPayloads[2], {
    id: "chatcmpl_test",
    object: "chat.completion.chunk",
    created: 123,
    model: "openai/gpt-5.4",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              function: { arguments: '{"query":"hel' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  });

  assert.deepEqual(jsonPayloads[3], {
    id: "chatcmpl_test",
    object: "chat.completion.chunk",
    created: 123,
    model: "openai/gpt-5.4",
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 3,
      total_tokens: 15,
    },
  });

  assert.deepEqual(outcomes, [
    {
      status: "success",
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        reasoningTokens: null,
        generationId: null,
        generationIds: [],
      },
      toolCalls: [{ name: "lookup_case", input: { query: "hello" } }],
    },
  ]);
});

test("createOpenAiChatCompletionStream emits final arguments when a tool-call follows the start chunk without deltas", async () => {
  const { createOpenAiChatCompletionStream } = await loadHandler();

  const response = createOpenAiChatCompletionStream({
    createResult: () => ({
      fullStream: (async function* streamChunks() {
        yield {
          type: "tool-input-start",
          toolCallId: "call_2",
          toolName: "lookup_case",
        };
        yield {
          type: "tool-call",
          toolCallId: "call_2",
          toolName: "lookup_case",
          input: { query: "hello" },
        };
        yield {
          type: "finish",
          finishReason: "tool-calls",
          totalUsage: { inputTokens: 9, outputTokens: 2 },
        };
      })(),
    }),
    responseId: "chatcmpl_test",
    created: 123,
    modelId: "openai/gpt-5.4",
  });

  const payloads = parseSsePayloads(await response.text());
  assert.deepEqual(payloads.at(-1), "[DONE]");

  const jsonPayloads = payloads
    .slice(0, -1)
    .map((payload) => JSON.parse(payload) as Record<string, unknown>);
  assert.equal(jsonPayloads.length, 4);

  assert.deepEqual(jsonPayloads[1], {
    id: "chatcmpl_test",
    object: "chat.completion.chunk",
    created: 123,
    model: "openai/gpt-5.4",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_2",
              type: "function",
              function: { name: "lookup_case", arguments: "" },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  });

  assert.deepEqual(jsonPayloads[2], {
    id: "chatcmpl_test",
    object: "chat.completion.chunk",
    created: 123,
    model: "openai/gpt-5.4",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              function: { arguments: '{"query":"hello"}' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  });
});

test("createOpenAiChatCompletionStream tracks distinct indexes for parallel tool calls", async () => {
  const { createOpenAiChatCompletionStream } = await loadHandler();

  const response = createOpenAiChatCompletionStream({
    createResult: () => ({
      fullStream: (async function* streamChunks() {
        yield {
          type: "tool-input-start",
          toolCallId: "call_a",
          toolName: "first_tool",
        };
        yield {
          type: "tool-input-start",
          toolCallId: "call_b",
          toolName: "second_tool",
        };
        yield {
          type: "tool-input-delta",
          toolCallId: "call_b",
          inputTextDelta: '{"k":1}',
        };
        yield {
          type: "tool-input-delta",
          toolCallId: "call_a",
          inputTextDelta: '{"x":1}',
        };
        yield {
          type: "tool-call",
          toolCallId: "call_a",
          toolName: "first_tool",
          input: { x: 1 },
        };
        yield {
          type: "tool-call",
          toolCallId: "call_b",
          toolName: "second_tool",
          input: { k: 1 },
        };
        yield {
          type: "finish",
          finishReason: "tool-calls",
          totalUsage: { inputTokens: 5, outputTokens: 7 },
        };
      })(),
    }),
    responseId: "chatcmpl_parallel",
    created: 300,
    modelId: "openai/gpt-5.4",
  });

  const payloads = parseSsePayloads(await response.text());
  assert.deepEqual(payloads.at(-1), "[DONE]");

  const jsonPayloads = payloads
    .slice(0, -1)
    .map((payload) => JSON.parse(payload) as Record<string, unknown>);

  // role chunk, two start chunks, two delta chunks, finish
  assert.equal(jsonPayloads.length, 6);

  // Each tool id locks its own index on first sight; subsequent argument
  // deltas reuse that index regardless of arrival order.
  const expectedToolDeltas = [
    {
      tool_calls: [
        {
          index: 0,
          id: "call_a",
          type: "function",
          function: { name: "first_tool", arguments: "" },
        },
      ],
    },
    {
      tool_calls: [
        {
          index: 1,
          id: "call_b",
          type: "function",
          function: { name: "second_tool", arguments: "" },
        },
      ],
    },
    { tool_calls: [{ index: 1, function: { arguments: '{"k":1}' } }] },
    { tool_calls: [{ index: 0, function: { arguments: '{"x":1}' } }] },
  ];
  for (let i = 0; i < expectedToolDeltas.length; i += 1) {
    const choices = (
      jsonPayloads[i + 1] as { choices: Array<{ delta: unknown }> }
    ).choices;
    assert.deepEqual(choices[0]?.delta, expectedToolDeltas[i]);
  }
});

test("createOpenAiChatCompletionStream emits a tool-call chunk that arrives without a prior start", async () => {
  const { createOpenAiChatCompletionStream } = await loadHandler();

  const response = createOpenAiChatCompletionStream({
    createResult: () => ({
      fullStream: (async function* streamChunks() {
        yield {
          type: "tool-call",
          toolCallId: "call_solo",
          toolName: "solo_tool",
          input: { go: true },
        };
        yield {
          type: "finish",
          finishReason: "tool-calls",
          totalUsage: { inputTokens: 1, outputTokens: 1 },
        };
      })(),
    }),
    responseId: "chatcmpl_solo",
    created: 400,
    modelId: "openai/gpt-5.4",
  });

  const payloads = parseSsePayloads(await response.text());
  assert.deepEqual(payloads.at(-1), "[DONE]");

  const jsonPayloads = payloads
    .slice(0, -1)
    .map((payload) => JSON.parse(payload) as Record<string, unknown>);
  // role + tool-call + finish
  assert.equal(jsonPayloads.length, 3);

  assert.deepEqual(jsonPayloads[1], {
    id: "chatcmpl_solo",
    object: "chat.completion.chunk",
    created: 400,
    model: "openai/gpt-5.4",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_solo",
              type: "function",
              function: {
                name: "solo_tool",
                arguments: '{"go":true}',
              },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  });
});
