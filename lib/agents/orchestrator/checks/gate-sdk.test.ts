import {
  streamText,
  convertToModelMessages,
  readUIMessageStream,
  type UIMessageChunk,
  type UIMessage,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, expect, it, vi } from "vitest";
import { buildControlTurnTools } from "@/app/api/control/chat/_lib/connection-tools";
import { verificationMessageMetadata } from "@/app/api/control/chat/_lib/verification-metadata";
import { toolCompletionEvent } from "@/lib/agents/tool-execution-event";
import { CHECK_KINDS } from "./plan";
import type { OrchestratorToolContext } from "../types";
import {
  repositoryCheckReceiptSchema,
  repositoryVerificationSummarySchema,
} from "./receipt";

const DISPLAY_LOG = "FULL_OPERATOR_CHECK_OUTPUT";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function exercise(
  scenario:
    | "full"
    | "later_edit"
    | "skip"
    | "cancel"
    | "cancel_later_edit"
    | "failed"
    | "lost"
    | "source_changed"
    | "no_manifest"
    | "missing_scripts"
    | "pending"
    | "invalid_probe"
    | "post_probe_lost"
) {
  vi.stubEnv("INTERNAL_API_SECRET", "unit-test-internal-secret");
  let source = "original";
  let probes = 0;
  let step = 0;
  const commands: string[] = [];
  const choices: unknown[] = [];
  const modelPrompts: string[] = [];
  const controller = new AbortController();
  const binding: NonNullable<OrchestratorToolContext["sandboxBinding"]> = {
    sandboxId: "workspace-1",
    status: "running",
  };
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
      sandboxBinding: binding,
      sandboxExecution: {
        checkOutput: async (output) => output,
        execute: async (_id, _headers, body) => {
          if (body.command.startsWith("node --input-type=commonjs")) {
            probes++;
            if (scenario === "invalid_probe")
              return Response.json({ exitCode: 0, stdout: "not-json" });
            if (scenario === "post_probe_lost" && probes === 2)
              return Response.json(
                { error: "Lost probe observation" },
                { status: 503 }
              );
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
                  available: scenario !== "no_manifest",
                  packageManager: "pnpm@10.12.4",
                  lockfiles: [],
                  scripts: ["no_manifest", "missing_scripts"].includes(scenario)
                    ? {}
                    : {
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
          if (scenario === "source_changed" && commands.length === 1)
            source = "edited-again";
          if (scenario === "lost" && commands.length === 1)
            return Response.json(
              { error: "Lost command observation" },
              { status: 500 }
            );
          if (scenario === "failed" && commands.length === 1)
            return Response.json({
              exitCode: 2,
              stdout:
                "FIRST_FAILURE_OUTPUT" + "x".repeat(8000) + "FAILURE_TAIL",
              stderr: "Typecheck failed.",
            });
          if (scenario === "cancel") controller.abort();
          return Response.json({
            exitCode: 0,
            stdout: DISPLAY_LOG + "x".repeat(8000),
            stderr: "",
          });
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
      modelPrompts.push(JSON.stringify(options.prompt));
      choices.push(options.toolChoice);
      // Script the provider interaction, including release of completion after
      // checks. A broken gate must fail an assertion, not make this fixture
      // repeatedly offer the same checks and starve the test runner's timers.
      const phases =
        scenario === "source_changed"
          ? ["edit", "checks", "checks", "answer"]
          : scenario === "pending"
            ? ["edit", "pending", "retry", "answer"]
            : [
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
      const checks = ["checks", "pending", "retry"].includes(phase);
      if (scenario === "pending")
        binding.status = phase === "pending" ? "pending" : "running";
      if (checks && phase !== "retry")
        expect(options.toolChoice).toEqual({ type: "required" });
      if (phase === "retry")
        expect(options.toolChoice?.type).not.toBe("required");
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
    instructions: built.systemPrompt,
    prompt: "Update the file and finish the authorized work.",
    allowSystemInMessages: true,
    tools: built.tools,
    prepareStep: built.verification.prepareStep(),
    stopWhen: () => false,
    abortSignal: controller.signal,
    onToolExecutionEnd: (event) =>
      built.verification.onToolEnd(toolCompletionEvent(event)),
  });
  const receipts = [];
  const chunks: UIMessageChunk[] = [];
  for await (const part of result.toUIMessageStream({
    messageMetadata: verificationMessageMetadata({
      call: { id: "call-1", metadata: {} },
      model: "test/model",
      verification: built.verification,
    }),
  })) {
    if (part.type === "error") throw new Error(part.errorText);
    chunks.push(part);
    if (part.type === "tool-output-available" && part.toolCallId !== "tool-1") {
      const receipt = repositoryCheckReceiptSchema.safeParse(part.output);
      if (receipt.success) receipts.push(receipt.data);
    }
  }
  // The durable transcript uses this same reducer, including metadata patches.
  let saved: UIMessage | undefined;
  for await (const message of readUIMessageStream({
    stream: new ReadableStream<UIMessageChunk>({
      start(sink) {
        for (const chunk of chunks) sink.enqueue(chunk);
        sink.close();
      },
    }),
  }))
    saved = message;
  const evidence = repositoryVerificationSummarySchema.safeParse(
    (saved?.metadata as { repository_verification?: unknown } | undefined)
      ?.repository_verification
  );
  const metadata = evidence.success ? evidence.data : undefined;
  const history: UIMessage[] =
    receipts.length > 0
      ? [
          {
            id: "prior-checks",
            role: "assistant",
            parts: [
              {
                type: "tool-run_checks",
                toolCallId: "prior-checks",
                state: "output-available",
                input: {},
                output: receipts.at(-1),
              },
            ],
          },
        ]
      : [];
  const historicalModelMessages = JSON.stringify(
    await convertToModelMessages(history, { tools: built.tools })
  );
  return {
    modelPrompts,
    historicalModelMessages,
    commands,
    choices,
    receipts,
    probes,
    source,
    metadata,
    summary: built.verification.summary(),
  };
}

it("tells the model checks are pending after each edit and removes that instruction after verification", async () => {
  const result = await exercise("later_edit");
  const prompts = result.modelPrompts.map(
    (prompt) => JSON.parse(prompt) as Array<{ role: string; content: unknown }>
  );
  for (const index of [1, 3]) {
    const systems = prompts[index].filter(
      (message) => message.role === "system"
    );
    const reminder = systems.at(-1);
    expect(reminder?.content).toContain("<repository_verification_pending>");
    expect(reminder?.content).toContain("run_checks");
    expect(
      prompts[index].findLastIndex((message) => message.role === "system")
    ).toBeLessThan(
      prompts[index].findIndex((message) => message.role !== "system")
    );
    expect(result.modelPrompts[index]).toContain(
      "Update the file and finish the authorized work."
    );
  }
  for (const index of [0, 2, 4])
    expect(result.modelPrompts[index]).not.toContain(
      "<repository_verification_pending>"
    );
});

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
  expect(result.modelPrompts.at(-1)?.includes(DISPLAY_LOG)).toBe(false);
  expect(result.historicalModelMessages.includes(DISPLAY_LOG)).toBe(false);
  expect(result.receipts[0].checks[0].stdout).toContain(DISPLAY_LOG);
  expect(result.metadata?.checks[0].stdout).toContain(DISPLAY_LOG);
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
  expect(result.probes).toBe(1);
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

it("a confirmed check failure still runs the other checks and preserves honest diagnostics", async () => {
  const result = await exercise("failed");
  expect(result.commands).toHaveLength(4);
  expect(result.receipts[0].checks.map((row) => row.status)).toEqual([
    "failed",
    "passed",
    "passed",
    "passed",
  ]);
  expect(result.receipts[0].verified).toBe(false);
  expect(result.metadata?.verified).toBe(false);
  expect(result.metadata?.checks[0].stdout).toContain("FIRST_FAILURE_OUTPUT");
  expect(result.modelPrompts.at(-1)).toContain("FAILURE_TAIL");
  expect(result.modelPrompts.at(-1)?.includes("FIRST_FAILURE_OUTPUT")).toBe(
    false
  );
});

it.each(["lost", "post_probe_lost"] as const)(
  "%s cannot verify or replay uncertain execution",
  async (scenario) => {
    const result = await exercise(scenario);
    expect(result.commands).toHaveLength(scenario === "lost" ? 1 : 4);
    expect(result.probes).toBe(scenario === "lost" ? 1 : 2);
    expect(result.receipts[0].commandCompletion).toBe("unknown");
    expect(result.receipts[0].verified).toBe(false);
    expect(result.metadata?.verified).toBe(false);
    expect(result.metadata?.error).toBeTruthy();
    expect(result.source).toBe("edited");
  }
);

it("source changed during checks requires a second complete sequence", async () => {
  const result = await exercise("source_changed");
  expect(result.commands).toHaveLength(8);
  expect(result.receipts).toHaveLength(2);
  expect(result.receipts[0].verified).toBe(false);
  expect(result.receipts[1].verified).toBe(true);
  expect(result.source).toBe("edited-again");
  expect(result.metadata?.verified).toBe(true);
});

it.each(["no_manifest", "missing_scripts"] as const)(
  "%s stays visibly unverified without invented commands",
  async (scenario) => {
    const result = await exercise(scenario);
    expect(result.commands).toEqual([]);
    expect(result.receipts[0].verified).toBe(false);
    expect(result.metadata?.verified).toBe(false);
    expect(result.metadata?.checks.map((row) => row.status)).toEqual([
      "not_run",
      "not_run",
      "not_run",
      "not_run",
    ]);
  }
);

it("a preflight rejection can recover through the real registry without repeating a live command", async () => {
  const result = await exercise("pending");
  expect(result.commands).toHaveLength(4);
  expect(result.receipts).toHaveLength(2);
  expect(result.receipts[0]).toMatchObject({
    verified: false,
    commandCompletion: "confirmed",
  });
  expect(result.receipts[1].verified).toBe(true);
  expect(result.metadata?.verified).toBe(true);
});

it("malformed output from a completed source probe is confirmed but never verified", async () => {
  const result = await exercise("invalid_probe");
  expect(result.commands).toEqual([]);
  expect(result.probes).toBe(1);
  expect(result.receipts[0]).toMatchObject({
    verified: false,
    commandCompletion: "confirmed",
  });
  expect(result.metadata?.verified).toBe(false);
});
