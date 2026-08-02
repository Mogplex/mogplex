import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-role-key";

function loadHandler() {
  return import("../../app/api/cli/inference/chat/completions/handler");
}

test("parseOpenAiToolCallArguments parses OpenAI-style JSON strings", async () => {
  const { parseOpenAiToolCallArguments } = await loadHandler();
  assert.deepEqual(parseOpenAiToolCallArguments('{ "query": "case number" }'), {
    query: "case number",
  });
});

test("parseOpenAiToolCallArguments falls back to an empty object for non-object values", async () => {
  const { parseOpenAiToolCallArguments } = await loadHandler();
  assert.deepEqual(parseOpenAiToolCallArguments('"lookup case"'), {});
  assert.deepEqual(parseOpenAiToolCallArguments('["a", "b"]'), {});
  assert.deepEqual(parseOpenAiToolCallArguments("{"), {});
});

test("toModelMessages converts assistant tool call arguments into object input", async () => {
  const { toModelMessages } = await loadHandler();
  const messages = toModelMessages([
    {
      role: "assistant",
      tool_calls: [
        {
          id: "call_123",
          type: "function",
          function: {
            name: "mcp__supabase__query",
            arguments: '{ "sql": "select 1" }',
          },
        },
      ],
    },
  ]);

  assert.equal(messages.length, 1);
  const assistant = messages[0];
  assert.equal(assistant?.role, "assistant");
  assert.ok(Array.isArray(assistant?.content));

  const toolCall = assistant?.content[0] as
    | {
        type?: string;
        toolCallId?: string;
        toolName?: string;
        input?: unknown;
      }
    | undefined;
  assert.equal(toolCall?.type, "tool-call");
  assert.equal(toolCall?.toolCallId, "call_123");
  assert.equal(toolCall?.toolName, "mcp__supabase__query");
  assert.deepEqual(toolCall?.input, { sql: "select 1" });
});

function parseSsePayloads(body: string) {
  return body
    .trim()
    .split("\n\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^data:\s*/, ""));
}

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

test("toOpenAiToolCalls maps non-streaming tool calls into the OpenAI shape", async () => {
  const { toOpenAiToolCalls } = await loadHandler();
  const mapped = toOpenAiToolCalls([
    {
      toolCallId: "call_abc",
      toolName: "lookup_case",
      input: { query: "hello" },
    },
    {
      toolCallId: "call_def",
      toolName: "search_files",
      input: { path: "src" },
    },
  ]);
  assert.deepEqual(mapped, [
    {
      id: "call_abc",
      type: "function",
      function: {
        name: "lookup_case",
        arguments: '{"query":"hello"}',
      },
    },
    {
      id: "call_def",
      type: "function",
      function: {
        name: "search_files",
        arguments: '{"path":"src"}',
      },
    },
  ]);
});

test("toOpenAiToolCalls returns undefined for an empty list", async () => {
  const { toOpenAiToolCalls } = await loadHandler();
  assert.equal(toOpenAiToolCalls([]), undefined);
});

test("toOpenAiToolCalls falls back to a generated id when toolCallId is missing", async () => {
  const { toOpenAiToolCalls } = await loadHandler();
  const mapped = toOpenAiToolCalls([{ toolName: "noop", input: {} }]);
  assert.ok(mapped, "expected mapped result");
  assert.equal(mapped.length, 1);
  const [first] = mapped;
  assert.ok(first);
  assert.equal(typeof first.id, "string");
  assert.ok(first.id.length > 0);
  assert.equal(first.function.name, "noop");
  assert.equal(first.function.arguments, "{}");
});

test("createOpenAiChatCompletionStream forwards text-delta chunks as content deltas", async () => {
  const { createOpenAiChatCompletionStream } = await loadHandler();

  const response = createOpenAiChatCompletionStream({
    createResult: () => ({
      fullStream: (async function* streamChunks() {
        yield { type: "text-delta", textDelta: "Hello, " };
        yield { type: "text-delta", textDelta: "world!" };
        yield { type: "text-delta", textDelta: "" };
        yield {
          type: "finish",
          finishReason: "stop",
          totalUsage: { inputTokens: 4, outputTokens: 6 },
        };
      })(),
    }),
    responseId: "chatcmpl_text",
    created: 200,
    modelId: "openai/gpt-5.4",
  });

  const payloads = parseSsePayloads(await response.text());
  assert.deepEqual(payloads.at(-1), "[DONE]");

  const jsonPayloads = payloads
    .slice(0, -1)
    .map((payload) => JSON.parse(payload) as Record<string, unknown>);
  // role assistant + 2 non-empty deltas + finish (empty text-delta is skipped)
  assert.equal(jsonPayloads.length, 4);

  const choice1 = (jsonPayloads[1] as { choices: Array<{ delta: unknown }> })
    .choices[0]?.delta;
  assert.deepEqual(choice1, { content: "Hello, " });

  const choice2 = (jsonPayloads[2] as { choices: Array<{ delta: unknown }> })
    .choices[0]?.delta;
  assert.deepEqual(choice2, { content: "world!" });

  const finish = jsonPayloads[3] as {
    choices: Array<{ finish_reason: unknown }>;
    usage: unknown;
  };
  assert.equal(finish.choices[0]?.finish_reason, "stop");
  assert.deepEqual(finish.usage, {
    prompt_tokens: 4,
    completion_tokens: 6,
    total_tokens: 10,
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

test("createOpenAiChatCompletionStream surfaces error chunks as structured SSE error frames", async () => {
  const { createOpenAiChatCompletionStream } = await loadHandler();
  const outcomes: unknown[] = [];

  const response = createOpenAiChatCompletionStream({
    createResult: () => ({
      fullStream: (async function* streamChunks() {
        yield {
          type: "tool-input-start",
          toolCallId: "call_err",
          toolName: "doomed_tool",
        };
        yield { type: "error", error: new Error("provider exploded") };
        // Anything after the error must not be emitted.
        yield {
          type: "finish",
          finishReason: "stop",
          totalUsage: { inputTokens: 1, outputTokens: 0 },
        };
      })(),
    }),
    responseId: "chatcmpl_err",
    created: 500,
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
  // role + tool-input-start + error frame (finish must not appear)
  assert.equal(jsonPayloads.length, 3);
  assert.deepEqual(jsonPayloads.at(-1), {
    error: { message: "provider exploded" },
  });
  assert.deepEqual(outcomes, [
    {
      status: "failed",
      error: "provider exploded",
      usage: {
        inputTokens: null,
        outputTokens: null,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        reasoningTokens: null,
        generationId: null,
        generationIds: [],
      },
    },
  ]);
});

test("createOpenAiChatCompletionStream captures finish-step usage and gateway metadata", async () => {
  const { createOpenAiChatCompletionStream } = await loadHandler();
  const outcomes: unknown[] = [];

  const response = createOpenAiChatCompletionStream({
    createResult: () => ({
      fullStream: (async function* streamChunks() {
        yield {
          type: "finish-step",
          usage: {
            inputTokens: 10,
            outputTokens: 4,
            inputTokenDetails: {
              cacheReadTokens: 7,
              cacheWriteTokens: 2,
            },
            outputTokenDetails: { reasoningTokens: 1 },
          },
          providerMetadata: {
            gateway: { generationId: "gen_123" },
          },
        };
        yield {
          type: "finish",
          finishReason: "stop",
          totalUsage: { inputTokens: 10, outputTokens: 4 },
        };
      })(),
    }),
    responseId: "chatcmpl_usage",
    created: 700,
    modelId: "openai/gpt-5.4",
    onOutcome(outcome) {
      outcomes.push(outcome);
    },
  });

  await response.text();

  assert.deepEqual(outcomes, [
    {
      status: "success",
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        cacheReadInputTokens: 7,
        cacheCreationInputTokens: 2,
        reasoningTokens: 1,
        generationId: "gen_123",
        generationIds: ["gen_123"],
      },
      toolCalls: [],
    },
  ]);
});

test("createOpenAiChatCompletionStream coerces non-Error error chunks to a string message", async () => {
  const { createOpenAiChatCompletionStream } = await loadHandler();

  const response = createOpenAiChatCompletionStream({
    createResult: () => ({
      fullStream: (async function* streamChunks() {
        yield { type: "error", error: "rate_limit_exceeded" };
      })(),
    }),
    responseId: "chatcmpl_err_str",
    created: 600,
    modelId: "openai/gpt-5.4",
  });

  const payloads = parseSsePayloads(await response.text());
  assert.deepEqual(payloads.at(-1), "[DONE]");

  const jsonPayloads = payloads
    .slice(0, -1)
    .map((payload) => JSON.parse(payload) as Record<string, unknown>);
  assert.deepEqual(jsonPayloads.at(-1), {
    error: { message: "rate_limit_exceeded" },
  });
});
