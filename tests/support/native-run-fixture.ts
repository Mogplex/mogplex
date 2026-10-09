import assert from "node:assert/strict";
import { streamText, tool } from "ai";
import { z } from "zod";
import type { HarnessProgressUpdate } from "@/lib/mogplex-api/harness-progress";
import { MockLanguageModelV4 } from "ai/test";
import { runNativeMogplexAgent } from "@/lib/mogplex-api/native-run";
import type { SkillSelectionInput } from "@/lib/decisions/skills";
import { createRunGuidanceSession } from "@/lib/slack/run-guidance-session";
import type { RunGuidance } from "@/lib/slack/run-guidance-store";
import {
  buildAiCall,
  buildRunRow,
} from "../unit/helpers/mogplex-api-runs-fixtures";

export async function exercise(
  mode:
    | "success"
    | "error"
    | "cancelled"
    | "unauthorized"
    | "lease_failure"
    | "tool_progress"
    | "guidance"
    | "agent",
  response = "Fixed the header.",
  metadata: Record<string, unknown> = {}
) {
  let call = buildAiCall({ model: "harness:mogplex", metadata });
  const run = buildRunRow({
    harness: "mogplex",
    metadata,
    ...(mode === "agent" ? { agent_id: "agent-1" } : {}),
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
  const finalReports: string[] = [];
  const toolEvidence: unknown[] = [];
  let cleaned = false;
  let closed = false;
  let executionLeaseAcquired = false;
  let systemSuffix: string | null | undefined;
  let invokedModel: string | undefined;
  let attachedSkillIds: readonly string[] | undefined;
  const skillChecks: SkillSelectionInput[] = [];
  let skillCheckStartedBeforeStream = false;
  let skillCheckSettled = false;
  const model = new MockLanguageModelV4({
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
        resolveAgent: async (input) => {
          assert.deepEqual(input, { agentId: "agent-1", userId: run.user_id });
          return {
            id: "agent-1",
            name: "NEXTJS-REVIEWER",
            slug: "nextjs-reviewer",
            model: null,
            systemPrompt: "Review App Router code carefully.",
            skills: [
              {
                id: "skill-1",
                name: "RSC Audit",
                description: null,
                content: "Look for use client.",
              },
            ],
            rules: [
              { id: "rule-1", name: "No any", content: "Never use any." },
            ],
            preset: false,
            teamId: null,
            ownerUserId: run.user_id,
          };
        },
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
            toolExecutionIdempotencyKey: call.id,
          };
        },
        resolveModel: async (_userId, requested, surface) => {
          if (metadata.run_origin === "slack") assert.equal(surface, "slack");
          return requested ?? "test/native-model";
        },
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
        observeSkills: async (input) => {
          skillChecks.push(input);
          // Slower than the whole run, so only an await can see it settle.
          await new Promise((resolve) => setTimeout(resolve, 40));
          skillCheckSettled = true;
        },
        createStream: async (input) => {
          invokedModel = input.resolvedModel;
          systemSuffix = input.systemSuffix;
          attachedSkillIds = input.attachedSkillIds;
          // The real stream reports the catalog once it has resolved it.
          input.onSkillsResolved?.({ invoked: [], available: [] });
          skillCheckStartedBeforeStream = skillChecks.length > 0;
          assert.equal(
            skillCheckSettled,
            false,
            "the skill check must never be awaited in front of the run"
          );
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
              stopWhen: () => false,
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
          if (event.toolName === "terminal_exec")
            toolEvidence.push(event.payload);
          if (event.payload?.kind === "assistant_final")
            finalReports.push(event.message ?? "");
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
    finalReports,
    toolEvidence,
    cleaned,
    closed,
    model,
    progress,
    guidanceSteps,
    systemSuffix,
    invokedModel,
    attachedSkillIds,
    skillChecks,
    skillCheckStartedBeforeStream,
    skillCheckSettled,
  };
}
