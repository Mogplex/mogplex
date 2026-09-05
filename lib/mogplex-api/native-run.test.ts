import assert from "node:assert/strict";
import { test } from "vitest";
import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { HarnessProgressUpdate } from "./harness-progress";
import { MockLanguageModelV3 } from "ai/test";
import { runNativeMogplexAgent } from "./native-run";
import { createRunGuidanceSession } from "@/lib/slack/run-guidance-session";
import type { RunGuidance } from "@/lib/slack/run-guidance-store";
import {
  buildAiCall,
  buildRunRow,
} from "../../tests/unit/helpers/mogplex-api-runs-fixtures";

async function exercise(
  mode:
    | "success"
    | "error"
    | "cancelled"
    | "unauthorized"
    | "lease_failure"
    | "tool_progress"
    | "guidance",
  response = "Fixed the header."
) {
  let call = buildAiCall({ model: "harness:mogplex" });
  const run = buildRunRow({
    harness: "mogplex",
    ...(mode === "tool_progress" || mode === "guidance"
      ? {
          metadata: {
            slack_guidance_enabled: mode === "guidance",
            slackRunControls: {
              teamId: "T1",
              channelId: "D1",
              messageTs: "1.2",
            },
          },
        }
      : {}),
  });
  const progress: HarnessProgressUpdate[] = [];
  let guidanceRows: RunGuidance[] = [];
  const guidanceSteps: number[] = [];
  let modelStep = 0;
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
          } else if (
            (mode === "tool_progress" || mode === "guidance") &&
            modelStep++ === 0
          ) {
            sink.enqueue({
              type: "tool-call",
              toolCallId: "progress-1",
              toolName: "report_progress",
              input: JSON.stringify({
                phase: "Verifying",
                summary: "Updated the header layout.",
                next: "Run the regression tests.",
              }),
            });
            sink.enqueue({
              type: "tool-call",
              toolCallId: "command-1",
              toolName: "terminal_exec",
              input: JSON.stringify({ command: "pnpm test" }),
            });
            sink.enqueue({
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool-calls" },
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
        ensureExecutionLease: async (_run, _sandbox, teamId) => {
          assert.equal(teamId, "team-1");
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
            teamId: "team-1",
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
            input.context.sandboxExecution?.retryOnSandboxLoss,
            false
          );
          assert.equal(
            executionLeaseAcquired,
            true,
            "reserve VM lifetime before starting the agent"
          );
          return {
            result: streamText({
              model,
              prompt: run.prompt,
              prepareStep: async ({ messages, stepNumber }) => ({
                messages: input.prepareMessages
                  ? await input.prepareMessages(messages, stepNumber)
                  : messages,
              }),
              abortSignal: input.abortSignal,
              tools: {
                ...input.additionalTools,
                terminal_exec: tool({
                  inputSchema: z.object({ command: z.string() }),
                  execute: async () => {
                    if (mode === "guidance")
                      guidanceRows = [
                        {
                          id: "00000000-0000-4000-8000-000000000005",
                          run_id: run.id,
                          user_id: run.user_id,
                          ai_call_id: run.ai_call_id,
                          body: "Keep the desktop header unchanged.",
                          status: "received",
                          attachments: null,
                          created_at: new Date(0).toISOString(),
                          delivered_step: null,
                        },
                      ];
                    return {
                      exitCode: 1,
                      stdout: "",
                      stderr: "test failure",
                    };
                  },
                }),
              },
              stopWhen: stepCountIs(3),
              ...input.hooks,
            }),
            connections: [],
            cleanup: async () => {
              cleaned = true;
            },
          };
        },
        createProgress: () => ({
          async report(update) {
            progress.push(update);
          },
          async flush() {},
        }),
        createGuidance: (row) =>
          createRunGuidanceSession(row, {
            load: async () => guidanceRows,
            deliver: async (receipt) => {
              assert.ok(
                JSON.stringify(model.doStreamCalls.at(-1)?.prompt).includes(
                  "Keep the desktop header unchanged."
                )
              );
              guidanceSteps.push(receipt.step);
              guidanceRows = guidanceRows.map((entry) => ({
                ...entry,
                status: "delivered",
                delivered_step: receipt.step,
              }));
              return receipt.ids.length;
            },
            queue: async () => {},
          }),
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
  return {
    call,
    result,
    caught,
    events,
    cleaned,
    closed,
    model,
    progress,
    guidanceSteps,
  };
}

test("a real SDK run receives mid-command Slack guidance at its next model step and acknowledges only afterward", async () => {
  const result = await exercise("guidance");
  assert.equal(result.caught, undefined);
  assert.equal(result.model.doStreamCalls.length, 2);
  assert.ok(
    !JSON.stringify(result.model.doStreamCalls[0].prompt).includes(
      "Keep the desktop header unchanged."
    )
  );
  assert.ok(
    JSON.stringify(result.model.doStreamCalls[1].prompt).includes(
      "Keep the desktop header unchanged."
    )
  );
  assert.deepEqual(result.guidanceSteps, [1]);
});

test("native SDK tool hooks retain identities, inputs, failed exits and complete text boundaries", async () => {
  const result = await exercise("tool_progress");
  assert.equal(result.caught, undefined);
  assert.ok(
    result.progress.some(
      (update) =>
        update.kind === "phase" &&
        update.phase === "Verifying" &&
        update.next === "Run the regression tests."
    )
  );
  assert.ok(
    result.progress.some(
      (update) =>
        update.kind === "tool_started" &&
        update.toolCallId === "command-1" &&
        JSON.stringify(update.input) ===
          JSON.stringify({ command: "pnpm test" })
    )
  );
  assert.ok(
    result.progress.some(
      (update) =>
        update.kind === "tool_finished" &&
        update.toolCallId === "command-1" &&
        (update.output as { exitCode: number }).exitCode === 1
    )
  );
  assert.equal(result.progress.at(-1)?.kind, "assistant_text_end");
  assert.equal(result.model.doStreamCalls.length, 2);
});

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
