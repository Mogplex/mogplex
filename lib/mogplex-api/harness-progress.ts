import { createHarnessOutputRenderer } from "@/lib/harness/output-renderer";
import type { HarnessRenderChunk } from "@/lib/harness/output-renderer";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs";
import { safeAppendAiCallEvent } from "@/lib/interactive-runs";

type AppendEvent = typeof safeAppendAiCallEvent;

/** A live action from the running agent, for surfacing outside the event log. */
export type HarnessProgressUpdate =
  | { kind: "assistant_text"; text: string }
  | { kind: "tool_started"; toolName: string }
  | { kind: "tool_finished"; toolName: string; state: string };

type OnProgress = (update: HarnessProgressUpdate) => void | Promise<void>;

async function emitProgress(
  onProgress: OnProgress | undefined,
  update: HarnessProgressUpdate
) {
  if (!onProgress) return;
  try {
    await onProgress(update);
  } catch (error) {
    // Progress surfacing is best-effort; never let it fail the run.
    console.warn("[harness-progress] progress hook failed", error);
  }
}

type HarnessStreamEvent = {
  type?: string;
  stream?: string;
  data?: string;
};

function parseSseDataEvents(buffer: string) {
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
    if (data) events.push(JSON.parse(data));
    separatorIndex = remaining.indexOf("\n\n");
  }
  return { events, remaining };
}

function eventContext(run: ExternalAgentRunRow) {
  return {
    aiCallId: run.ai_call_id,
    userId: run.user_id,
    conversationId: run.conversation_id,
    repoId: run.repo_id,
  };
}

function toolFinishedMessage(name: string, state: string) {
  if (state === "error") return `${name} failed`;
  if (state === "denied") return `${name} denied`;
  return `${name} finished`;
}

async function persistRenderedProgress(input: {
  rendered: HarnessRenderChunk;
  run: ExternalAgentRunRow;
  appendEvent: AppendEvent;
  toolStates: Map<string, string>;
  onProgress?: OnProgress;
}) {
  if (input.rendered.text) {
    await input.appendEvent({
      ...eventContext(input.run),
      eventType: "log",
      message: input.rendered.text,
      payload: { kind: "assistant_delta" },
    });
    await emitProgress(input.onProgress, {
      kind: "assistant_text",
      text: input.rendered.text,
    });
  }

  for (const tool of input.rendered.toolCalls ?? []) {
    const previous = input.toolStates.get(tool.id);
    if (previous === tool.state) continue;
    input.toolStates.set(tool.id, tool.state);

    if (previous === undefined && tool.state === "running") {
      await input.appendEvent({
        ...eventContext(input.run),
        eventType: "tool_started",
        toolName: tool.name,
        message: `${tool.name} started`,
        payload: { kind: "tool", toolCallId: tool.id, state: tool.state },
      });
      await emitProgress(input.onProgress, {
        kind: "tool_started",
        toolName: tool.name,
      });
      continue;
    }

    if (tool.state !== "running") {
      await input.appendEvent({
        ...eventContext(input.run),
        eventType: "tool_finished",
        toolName: tool.name,
        message: toolFinishedMessage(tool.name, tool.state),
        payload: { kind: "tool", toolCallId: tool.id, state: tool.state },
      });
      await emitProgress(input.onProgress, {
        kind: "tool_finished",
        toolName: tool.name,
        state: tool.state,
      });
    }
  }
}

async function persistHarnessEvents(input: {
  events: unknown[];
  renderer: ReturnType<typeof createHarnessOutputRenderer>;
  run: ExternalAgentRunRow;
  appendEvent: AppendEvent;
  toolStates: Map<string, string>;
  onProgress?: OnProgress;
}) {
  for (const event of input.events) {
    if (!event || typeof event !== "object") continue;
    const typedEvent = event as HarnessStreamEvent;
    if (typedEvent.type === "error") {
      throw new Error(typedEvent.data || "Harness run failed");
    }
    if (typedEvent.type !== "log" || typeof typedEvent.data !== "string") {
      continue;
    }
    await persistRenderedProgress({
      rendered: input.renderer.push(
        typedEvent.stream ?? "stdout",
        typedEvent.data
      ),
      run: input.run,
      appendEvent: input.appendEvent,
      toolStates: input.toolStates,
      onProgress: input.onProgress,
    });
  }
}

export async function readExternalHarnessProgress(input: {
  response: Response;
  run: ExternalAgentRunRow;
  appendEvent?: AppendEvent;
  /** Best-effort live surface for run actions (e.g. the Slack thread feed). */
  onProgress?: OnProgress;
}): Promise<void> {
  if (!input.response.body) return;

  const appendEvent = input.appendEvent ?? safeAppendAiCallEvent;
  const renderer = createHarnessOutputRenderer(input.run.harness);
  const toolStates = new Map<string, string>();
  const reader = input.response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseDataEvents(buffer);
    buffer = parsed.remaining;

    await persistHarnessEvents({
      events: parsed.events,
      renderer,
      run: input.run,
      appendEvent,
      toolStates,
      onProgress: input.onProgress,
    });
  }

  await persistRenderedProgress({
    rendered: renderer.flush(),
    run: input.run,
    appendEvent,
    toolStates,
    onProgress: input.onProgress,
  });
}
