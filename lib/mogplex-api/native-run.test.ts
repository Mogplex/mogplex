import assert from "node:assert/strict";
import { test } from "vitest";
import { streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { runNativeMogplexAgent } from "./native-run";
import {
  buildAiCall,
  buildRunRow,
} from "../../tests/unit/helpers/mogplex-api-runs-fixtures";

async function exercise(
  mode: "success" | "error" | "cancelled" | "unauthorized" | "lease_failure",
  response = "Fixed the header."
) {
  let call = buildAiCall({ model: "harness:mogplex" });
  const run = buildRunRow({ harness: "mogplex" });
  const controller = new AbortController();
  const events: string[] = [];
  let cleaned = false;
  let closed = false;
  let executionLeaseAcquired = false;
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(sink) {
          if (mode === "error") {
            sink.enqueue({
              type: "error",
              error: new Error("Provider disconnected"),
            });
          } else {
            sink.enqueue({ type: "text-start", id: "text" });
            for (const delta of response) {
              sink.enqueue({ type: "text-delta", id: "text", delta });
            }
            sink.enqueue({ type: "text-end", id: "text" });
            sink.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: {
                  total: 12,
                  noCache: 12,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 5, text: 5, reasoning: 0 },
              },
            });
          }
          sink.close();
        },
      }),
    }),
  });
  let caught: unknown;
  let result: { output: string } | undefined;
  try {
    result = await runNativeMogplexAgent(
      run,
      { recordId: "sandbox-record-1", sandboxId: "sbx_123" },
      {
        loadCall: async () => call,
        ensureExecutionLease: async () => {
          if (mode === "lease_failure") throw new Error("Lease refused");
          executionLeaseAcquired = true;
        },
        loadContext: async () => {
          if (mode === "unauthorized")
            throw new Error("Active sandbox not found for this agent run");
          return {
            userId: run.user_id,
            repoId: run.repo_id,
            repoFullName: "example/app",
            repoOwner: "example",
            repoName: "app",
            repoBranch: "fix/header",
            repoBaseBranch: "main",
            sandboxId: "sandbox-record-1",
            teamId: null,
            conversationId: null,
            workspaceSessionId: null,
            surface: "chat",
            enableTools: true,
            latestUserText: run.prompt,
            toolExecutionIdempotencyKey: call.id,
          };
        },
        resolveModel: async () => "test/native-model",
        buildMessages: async () => [
          { role: "user", parts: [{ type: "text", text: run.prompt }] },
        ],
        createControl: async () => {
          if (mode === "cancelled") controller.abort();
          return {
            signal: controller.signal,
            isCancelled: () => mode === "cancelled",
            async close() {
              closed = true;
            },
          };
        },
        createStream: async (input) => {
          assert.equal(
            executionLeaseAcquired,
            true,
            "reserve VM lifetime before starting the agent"
          );
          return {
            result: streamText({
              model,
              prompt: run.prompt,
              abortSignal: input.abortSignal,
              ...input.hooks,
            }),
            connections: [],
            cleanup: async () => {
              cleaned = true;
            },
          };
        },
        createProgress: () => ({ async report() {}, async flush() {} }),
        updateCall: async (_id, update) => {
          call = { ...call, ...update };
          return call;
        },
        finishCall: async (_id, update) => {
          call = { ...call, ...update };
          return call;
        },
        cancelCall: async (_id, update) => {
          call = { ...call, ...update };
          return call;
        },
        appendEvent: async (event) => {
          events.push(event.eventType);
          return null;
        },
      }
    );
  } catch (error) {
    caught = error;
  }
  return { call, result, caught, events, cleaned, closed, model };
}

test("native runner consumes real SDK output and records usage on the existing call", async () => {
  const result = await exercise("success");
  assert.equal(result.caught, undefined);
  assert.equal(result.result?.output, "Fixed the header.");
  assert.equal(result.call.id, "call-1");
  assert.equal(result.call.model, "test/native-model");
  assert.equal(result.call.status, "success");
  assert.equal(result.call.input_tokens, 12);
  assert.equal(result.call.output_tokens, 5);
  assert.ok(result.events.includes("log"));
  assert.equal(result.events.filter((event) => event === "log").length, 1);
  assert.ok(result.events.includes("finished"));
  assert.ok(result.cleaned && result.closed);
});

test("native runner bounds telemetry writes for a long token-sized stream", async () => {
  const response = "x".repeat(5000);
  const result = await exercise("success", response);
  assert.equal(result.result?.output, response);
  assert.equal(result.events.filter((event) => event === "log").length, 3);
});

test("native provider failure cannot become a successful empty run", async () => {
  const result = await exercise("error");
  assert.match(String(result.caught), /Provider disconnected/);
  assert.equal(result.call.status, "failed");
  assert.ok(!result.events.includes("finished"));
  assert.ok(result.cleaned && result.closed);
});

test("native cancellation prevents model execution and finalizes the existing call", async () => {
  const result = await exercise("cancelled");
  assert.equal(result.caught, undefined);
  assert.equal(result.call.status, "cancelled");
  assert.equal(result.model.doStreamCalls.length, 0);
  assert.ok(result.closed);
});

test("unavailable owned sandbox fails before model execution", async () => {
  const result = await exercise("unauthorized");
  assert.match(String(result.caught), /Active sandbox not found/);
  assert.equal(result.call.status, "failed");
  assert.equal(result.model.doStreamCalls.length, 0);
  assert.ok(result.closed);
});

test("a failed execution lease prevents model work and finalizes the call", async () => {
  const result = await exercise("lease_failure");
  assert.match(String(result.caught), /Lease refused/);
  assert.equal(result.call.status, "failed");
  assert.equal(result.model.doStreamCalls.length, 0);
  assert.ok(result.closed);
});
