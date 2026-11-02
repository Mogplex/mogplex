import { streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, expect, it, vi } from "vitest";
import { buildControlTurnTools } from "@/app/api/control/chat/_lib/connection-tools";
import { verificationMessageMetadata } from "@/app/api/control/chat/_lib/verification-metadata";
import { toolCompletionEvent } from "@/lib/agents/tool-execution-event";
import { CHECK_KINDS } from "./plan";
import {
  repositoryCheckReceiptSchema,
  repositoryVerificationSummarySchema,
  type RepositoryVerificationSummary,
} from "./receipt";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function exercise(
  scenario: "full" | "later_edit" | "skip" | "cancel" | "cancel_later_edit"
) {
  vi.stubEnv("INTERNAL_API_SECRET", "unit-test-internal-secret");
  let source = "original";
  let probes = 0;
  let step = 0;
  const commands: string[] = [];
  const choices: unknown[] = [];
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!url.pathname.endsWith("/files"))
        throw new Error(`Unexpected request: ${url.pathname}`);
      if (init?.method === "PUT") {
        source = JSON.parse(String(init.body)).content;
        if (scenario === "cancel_later_edit" && step === 3) controller.abort();
        return Response.json({ ok: true });
      }
      return Response.json({ content: source });
    }
  );
  const built = buildControlTurnTools({
    toolContext: {
      userId: "user-1",
      repoId: "repo-1",
      controlMode: "run",
      repoBranch: "feature/checks",
      sandboxBinding: { sandboxId: "workspace-1", status: "running" },
      sandboxExecution: {
        checkOutput: async (output) => output,
        execute: async (_id, _headers, body) => {
          if (body.command.startsWith("node --input-type=commonjs")) {
            probes++;
            return Response.json({
              exitCode: 0,
              stdout: JSON.stringify({
                revision: (source === "original"
                  ? "a"
                  : source === "edited"
                    ? "b"
                    : "c"
                ).repeat(64),
                manifest: {
                  available: true,
                  packageManager: "pnpm@10.12.4",
                  lockfiles: [],
                  scripts: {
                    typecheck: "defined",
                    lint: "defined",
                    build: "defined",
                    "test:all": "defined",
                  },
                },
              }),
            });
          }
          commands.push(body.command);
          if (scenario === "cancel") controller.abort();
          return Response.json({ exitCode: 0, stdout: "Passed", stderr: "" });
        },
      },
    },
    promptContext: { repoFullName: "acme/app" },
    connectionTools: {
      tools: {},
      connections: [],
      askToolNames: new Set(),
      cleanup: async () => undefined,
    },
    enableTools: true,
  });
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      step++;
      choices.push(options.toolChoice);
      // Script the provider interaction, including release of completion after
      // checks. A broken gate must fail an assertion, not make this fixture
      // repeatedly offer the same checks and starve the test runner's timers.
      const phases = [
        "edit",
        "checks",
        ...(["later_edit", "cancel_later_edit"].includes(scenario)
          ? ["edit", "checks"]
          : []),
        "answer",
      ];
      const phase = phases[step - 1];
      expect(phase).toBeDefined();
      const edit = phase === "edit";
      const checks = phase === "checks";
      if (checks) expect(options.toolChoice).toEqual({ type: "required" });
      if (phase === "answer")
        expect(options.toolChoice?.type).not.toBe("required");
      return {
        stream: new ReadableStream({
          start(sink) {
            if (edit || checks)
              sink.enqueue({
                type: "tool-call",
                toolCallId: `tool-${step}`,
                toolName: edit ? "write_file" : "run_checks",
                input: JSON.stringify(
                  edit
                    ? {
                        path: "index.ts",
                        content: step === 1 ? "edited" : "edited-again",
                      }
                    : scenario === "skip"
                      ? {
                          skip: CHECK_KINDS,
                          reason: "The operator requested file changes only.",
                        }
                      : {}
                ),
              });
            else {
              sink.enqueue({ type: "text-start", id: "answer" });
              sink.enqueue({
                type: "text-delta",
                id: "answer",
                delta: "Finished with the recorded check results.",
              });
              sink.enqueue({ type: "text-end", id: "answer" });
            }
            sink.enqueue({
              type: "finish",
              finishReason: {
                unified: edit || checks ? "tool-calls" : "stop",
                raw: "test",
              },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            });
            sink.close();
          },
        }),
      };
    },
  });
  const result = streamText({
    model,
    prompt: "Update the file and finish the authorized work.",
    tools: built.tools,
    prepareStep: built.verification.prepareStep(),
    stopWhen: () => false,
    abortSignal: controller.signal,
    onToolExecutionEnd: (event) =>
      built.verification.onToolEnd(toolCompletionEvent(event)),
  });
  const receipts = [];
  let metadata: RepositoryVerificationSummary | undefined;
  for await (const part of result.toUIMessageStream({
    messageMetadata: verificationMessageMetadata({
      call: { id: "call-1", metadata: {} },
      model: "test/model",
      verification: built.verification,
    }),
  })) {
    if (part.type === "error") throw new Error(part.errorText);
    if (part.type === "message-metadata") {
      const value = part.messageMetadata as {
        repository_verification?: unknown;
      };
      const summary = repositoryVerificationSummarySchema.safeParse(
        value.repository_verification
      );
      if (summary.success) metadata = summary.data;
    }
    if (part.type === "tool-output-available" && part.toolCallId !== "tool-1") {
      const receipt = repositoryCheckReceiptSchema.safeParse(part.output);
      if (receipt.success) receipts.push(receipt.data);
    }
  }
  return {
    commands,
    choices,
    receipts,
    probes,
    source,
    metadata,
    summary: built.verification.summary(),
  };
}

it("the real Control tool registry forces all four full scripts before model completion", async () => {
  const result = await exercise("full");
  expect(result.source).toBe("edited");
  expect(result.choices[1]).toEqual({ type: "required" });
  expect(result.commands).toEqual([
    "CI=1 pnpm run typecheck",
    "CI=1 pnpm run lint",
    "CI=1 pnpm run build",
    "CI=1 pnpm run test:all",
  ]);
  expect(result.receipts).toHaveLength(1);
  expect(result.receipts[0]).toMatchObject({
    ok: true,
    verified: true,
    commandCompletion: "confirmed",
  });
  expect(result.summary.verified).toBe(true);
  expect(result.metadata?.verified).toBe(true);
});

it("a later edit requires another complete check sequence", async () => {
  const result = await exercise("later_edit");
  expect(result.source).toBe("edited-again");
  expect(result.commands).toHaveLength(8);
  expect(result.receipts).toHaveLength(2);
  expect(result.receipts[0].workspaceRevisionAfter).not.toBe(
    result.receipts[1].workspaceRevisionAfter
  );
  expect(result.summary.verified).toBe(true);
});

it("an explicit operator limit leaves every omitted check visible without running its script", async () => {
  const result = await exercise("skip");
  expect(result.commands).toEqual([]);
  expect(result.receipts).toHaveLength(1);
  expect(result.receipts[0]).toMatchObject({ ok: true, verified: false });
  expect(result.receipts[0].checks.map((row) => row.status)).toEqual([
    "skipped",
    "skipped",
    "skipped",
    "skipped",
  ]);
  expect(result.summary.verified).toBe(false);
  expect(
    result.metadata?.checks.every((check) => check.status === "skipped")
  ).toBe(true);
});

it("Stop aborts the sequence before another check or final inspection starts", async () => {
  const result = await exercise("cancel");
  expect(result.source).toBe("edited");
  expect(result.commands).toEqual(["CI=1 pnpm run typecheck"]);
  expect(result.probes).toBe(3);
  expect(result.summary.verified).toBe(false);
  expect(result.metadata?.verified).toBe(false);
});

it("Stop during a later edit cannot leave an earlier passing badge on changed contents", async () => {
  const result = await exercise("cancel_later_edit");
  expect(result.source).toBe("edited-again");
  expect(result.commands).toHaveLength(4);
  expect(result.metadata?.verified).toBe(false);
  expect(result.metadata?.error).toBeTruthy();
  expect(
    result.metadata?.checks.every((check) => check.status === "blocked")
  ).toBe(true);
});
