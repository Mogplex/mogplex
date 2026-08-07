import assert from "node:assert/strict";
import test from "node:test";
import { loadHandler } from "./helpers/cli-inference-handler-fixtures";

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
