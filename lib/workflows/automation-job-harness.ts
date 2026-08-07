import { supabaseAdmin } from "@/lib/supabase/admin";
import { createHarnessOutputRenderer } from "@/lib/harness/output-renderer";
import type { HarnessId } from "@/lib/harness/config";
import type { ReviewOutcome } from "@/lib/workflows/pr-review-harness";
import {
  JobRunCancelledError,
  type AutomationAgentResult,
  type JobContext,
  type PullRequestDetails,
} from "@/lib/workflows/automation-job-types";
import {
  isRecord,
  readTextResponse,
} from "@/lib/workflows/automation-job-utils";
import {
  buildAutomationHarnessPrompt,
  parseAutomationHarnessReviewResult,
  stripAutomationHarnessReviewMarker,
} from "@/lib/workflows/automation-job-prompts";
import {
  buildAutofixSandboxInternalApiHeaders,
  launchAutofixSandbox,
  launchAutomationHarnessSandbox,
} from "@/lib/workflows/automation-job-sandbox-setup";

function parseAutomationHarnessSseEvents(buffer: string) {
  const events: unknown[] = [];
  let remaining = buffer;
  let separatorIndex = remaining.indexOf("\n\n");

  while (separatorIndex !== -1) {
    const rawEvent = remaining.slice(0, separatorIndex);
    remaining = remaining.slice(separatorIndex + 2);
    const data = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if (data) {
      try {
        events.push(JSON.parse(data));
      } catch {
        // Ignore a malformed stream event; the terminal event still decides
        // whether the harness run succeeded.
      }
    }
    separatorIndex = remaining.indexOf("\n\n");
  }

  return { events, remaining };
}

async function attachAutomationHarnessAiCall(input: {
  aiCallId: string;
  jobRunId: string;
  context: JobContext;
}) {
  const { data, error } = await supabaseAdmin
    .from("ai_calls")
    .select("metadata")
    .eq("id", input.aiCallId)
    .eq("user_id", input.context.repo.user_id)
    .maybeSingle();

  if (error || !data) {
    console.warn("[automation-job] failed to load harness ai_call", {
      aiCallId: input.aiCallId,
      jobRunId: input.jobRunId,
      error: error?.message ?? "missing ai_call",
    });
    return;
  }

  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const { error: updateError } = await supabaseAdmin
    .from("ai_calls")
    .update({
      job_run_id: input.jobRunId,
      metadata: {
        ...metadata,
        ...input.context.metadata,
        source: "automation",
      },
    })
    .eq("id", input.aiCallId)
    .eq("user_id", input.context.repo.user_id);

  if (updateError) {
    console.warn("[automation-job] failed to attach harness ai_call", {
      aiCallId: input.aiCallId,
      jobRunId: input.jobRunId,
      error: updateError.message,
    });
  }
}

async function readAutomationHarnessStream(input: {
  response: Response;
  harnessId: HarnessId;
  jobRunId: string;
  context: JobContext;
}) {
  if (!input.response.body) {
    throw new Error("Harness response did not include a stream");
  }

  const reader = input.response.body.getReader();
  const decoder = new TextDecoder();
  const renderer = createHarnessOutputRenderer(input.harnessId);
  let buffer = "";
  let text = "";
  let aiCallId: string | null = null;
  let exitCode: number | null = null;
  let streamError: string | null = null;
  let cancelled = false;
  let toolCalls: Array<{
    name: string;
    input?: unknown;
    output?: unknown;
  }> = [];

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseAutomationHarnessSseEvents(buffer);
    buffer = parsed.remaining;

    for (const event of parsed.events) {
      if (!isRecord(event) || typeof event.type !== "string") continue;

      if (event.type === "run" && typeof event.ai_call_id === "string") {
        aiCallId = event.ai_call_id;
        await attachAutomationHarnessAiCall({
          aiCallId,
          jobRunId: input.jobRunId,
          context: input.context,
        });
        continue;
      }

      if (event.type === "log" && typeof event.data === "string") {
        const rendered = renderer.push(
          typeof event.stream === "string" ? event.stream : "stdout",
          event.data
        );
        text += rendered.text;
        if (rendered.toolCalls) {
          toolCalls = rendered.toolCalls.map((toolCall) => ({
            name: toolCall.name,
            input: toolCall.input,
            output: toolCall.output,
          }));
        }
        continue;
      }

      if (event.type === "done") {
        exitCode = typeof event.exitCode === "number" ? event.exitCode : null;
        continue;
      }

      if (event.type === "cancelled") {
        cancelled = true;
        continue;
      }

      if (event.type === "error") {
        streamError =
          typeof event.data === "string" ? event.data : "Harness run failed";
      }
    }
  }

  const flushed = renderer.flush();
  text += flushed.text;
  if (flushed.toolCalls) {
    toolCalls = flushed.toolCalls.map((toolCall) => ({
      name: toolCall.name,
      input: toolCall.input,
      output: toolCall.output,
    }));
  }

  if (cancelled) throw new JobRunCancelledError();
  if (streamError) throw new Error(streamError);
  if (exitCode !== 0) {
    throw new Error(`Harness exited with code ${exitCode ?? "unknown"}`);
  }

  return {
    text: text.trim(),
    aiCallId,
    toolCalls,
  };
}

export async function runAutomationHarnessAgent(input: {
  jobRunId: string;
  context: JobContext;
  harnessId: HarnessId;
  review?: ReviewOutcome | null;
  pullRequest?: PullRequestDetails | null;
  targetRepo?: JobContext["repo"] | null;
}): Promise<AutomationAgentResult> {
  "use step";

  const sandbox =
    input.pullRequest && input.targetRepo
      ? await launchAutofixSandbox({
          context: input.context,
          pullRequest: input.pullRequest,
          targetRepo: input.targetRepo,
        })
      : await launchAutomationHarnessSandbox(input.context);
  const prompt = buildAutomationHarnessPrompt(input);
  const { createSandboxHarnessPostHandler } =
    await import("@/app/api/sandbox/[id]/harness/route");
  const response = await createSandboxHarnessPostHandler()(
    new Request(
      `https://internal.mogplex/api/sandbox/${sandbox.recordId}/harness`,
      {
        method: "POST",
        headers: buildAutofixSandboxInternalApiHeaders(input.context),
        body: JSON.stringify({
          harness: input.harnessId,
          prompt,
          mode: "AUTO",
        }),
      }
    ),
    { params: Promise.resolve({ id: sandbox.recordId }) }
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok && contentType.includes("application/json")) {
    const payload = (await response.json()) as { error?: unknown };
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Harness run failed"
    );
  }
  if (!response.ok) {
    throw new Error((await readTextResponse(response)) || "Harness run failed");
  }

  const streamed = await readAutomationHarnessStream({
    response,
    harnessId: input.harnessId,
    jobRunId: input.jobRunId,
    context: input.context,
  });
  const role = input.context.metadata.flow_node_role;
  const reviewOutcome =
    role === "review"
      ? parseAutomationHarnessReviewResult(streamed.text)
      : null;

  if (role === "review" && !reviewOutcome) {
    throw new Error(
      `${input.harnessId === "claude-code" ? "Claude Code" : "Codex"} completed without a structured review result`
    );
  }

  const text =
    stripAutomationHarnessReviewMarker(streamed.text) ||
    reviewOutcome?.summary ||
    "Harness completed";
  const steps: AutomationAgentResult["steps"] =
    streamed.toolCalls.length > 0
      ? [
          {
            toolCalls: streamed.toolCalls.map((toolCall) => ({
              toolName: toolCall.name,
              input: toolCall.input,
            })),
            toolResults: streamed.toolCalls.map((toolCall) => toolCall.output),
          },
        ]
      : [];

  if (reviewOutcome) {
    steps.push({
      toolCalls: [
        {
          toolName: "reportReview",
          input: reviewOutcome,
        },
      ],
      toolResults: [reviewOutcome],
    });
  }

  return {
    text,
    steps,
    usage: null,
    aiCallId: streamed.aiCallId,
  };
}
