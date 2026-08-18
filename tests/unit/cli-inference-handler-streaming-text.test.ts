import assert from "node:assert/strict";
import test from "node:test";
import {
  loadHandler,
  parseSsePayloads,
} from "./helpers/cli-inference-handler-fixtures";

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
        yield { type: "text-delta", textDelta: "Done" };
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

test("createOpenAiChatCompletionStream rejects an empty successful model response", async () => {
  const { createOpenAiChatCompletionStream } = await loadHandler();
  const outcomes: unknown[] = [];

  const response = createOpenAiChatCompletionStream({
    createResult: () => ({
      fullStream: (async function* streamChunks() {
        yield {
          type: "finish",
          finishReason: "stop",
          totalUsage: { inputTokens: 10, outputTokens: 0 },
        };
      })(),
    }),
    responseId: "chatcmpl_empty",
    created: 800,
    modelId: "deepseek/deepseek-v4-pro",
    onOutcome(outcome) {
      outcomes.push(outcome);
    },
  });

  const payloads = parseSsePayloads(await response.text());
  const jsonPayloads = payloads
    .slice(0, -1)
    .map((payload) => JSON.parse(payload) as Record<string, unknown>);
  assert.deepEqual(jsonPayloads.at(-1), {
    error: {
      message:
        "The model returned no output. Open /model. Choose another model, then retry.",
    },
  });
  assert.deepEqual(outcomes, [
    {
      status: "failed",
      error:
        "The model returned no output. Open /model. Choose another model, then retry.",
      usage: {
        inputTokens: 10,
        outputTokens: 0,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        reasoningTokens: null,
        generationId: null,
        generationIds: [],
      },
    },
  ]);
});

test("createOpenAiChatCompletionStream waits for outcome persistence before closing", async () => {
  const { createOpenAiChatCompletionStream } = await loadHandler();
  let outcomeAwaited = false;

  const response = createOpenAiChatCompletionStream({
    createResult: () => ({
      fullStream: (async function* streamChunks() {
        yield { type: "text-delta", textDelta: "Done" };
        yield {
          type: "finish",
          finishReason: "stop",
          totalUsage: { inputTokens: 1, outputTokens: 1 },
        };
      })(),
    }),
    responseId: "chatcmpl_durable",
    created: 900,
    modelId: "openai/gpt-5.4",
    onOutcome: (() => ({
      then(resolve: () => void) {
        outcomeAwaited = true;
        resolve();
      },
    })) as never,
  });

  const body = await response.text();
  assert.equal(outcomeAwaited, true);
  assert.match(body, /data: \[DONE\]/);
});
