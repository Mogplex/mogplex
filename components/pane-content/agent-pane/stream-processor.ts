import type {
  LocalMessageSegment,
  LocalToolCall,
} from "@/hooks/use-conversations";
import type { HarnessId } from "@/lib/harness/config";
import { createHarnessOutputRenderer } from "@/lib/harness/output-renderer";

export interface StreamState {
  output: string;
  installText: string;
  trailerText: string;
  renderedSegments: LocalMessageSegment[];
  toolCalls: LocalToolCall[] | undefined;
  finalExitCode: number | null;
  finalError: string | null;
  wasCancelled: boolean;
}

export interface StreamEvent {
  type: string;
  stream?: string;
  data?: string;
  exitCode?: number | null;
  error?: string | null;
  failureCode?: string | null;
  ai_call_id?: string;
  sessionId?: string;
  pullRequestUrl?: string;
}

export interface StreamProcessorCallbacks {
  onActiveHarnessCallId: (id: string) => void;
  onClearActiveHarnessCallId: () => void;
  onSessionId: (sessionId: string, sandboxId: string | null) => void;
}

export function createStreamProcessor(
  harnessId: HarnessId,
  preludeText: string,
  callbacks: StreamProcessorCallbacks
) {
  const outputRenderer = createHarnessOutputRenderer(harnessId);
  const state: StreamState = {
    output: preludeText,
    installText: "",
    trailerText: "",
    renderedSegments: [],
    toolCalls: undefined,
    finalExitCode: null,
    finalError: null,
    wasCancelled: false,
  };

  function buildSegments(): LocalMessageSegment[] {
    const segments: LocalMessageSegment[] = [];
    if (preludeText.trim()) {
      segments.push({ type: "text", text: preludeText.trim() });
    }
    if (state.installText.trim()) {
      segments.push({ type: "text", text: state.installText.trim() });
    }
    for (const segment of state.renderedSegments) {
      segments.push(
        segment.type === "text"
          ? { type: "text", text: segment.text }
          : { type: "tool-call", toolCall: { ...segment.toolCall } }
      );
    }
    if (state.trailerText.trim()) {
      segments.push({ type: "text", text: state.trailerText.trim() });
    }
    return segments;
  }

  function processEvent(event: StreamEvent, sandboxId: string | null): void {
    switch (event.type) {
      case "run":
        if (event.ai_call_id) {
          callbacks.onActiveHarnessCallId(event.ai_call_id);
        }
        break;

      case "session":
        if (event.sessionId) {
          callbacks.onSessionId(event.sessionId, sandboxId);
        }
        break;

      case "install":
        if (event.data) {
          const chunk = `[installing...]\n${event.data}\n`;
          state.installText += chunk;
          state.output += chunk;
        }
        break;

      case "log":
        if (event.data) {
          const rendered = outputRenderer.push(
            event.stream ?? "stdout",
            event.data
          );
          state.output += rendered.text;
          if (rendered.toolCalls) {
            state.toolCalls = rendered.toolCalls;
          }
          if (rendered.segments) {
            state.renderedSegments = rendered.segments;
          }
        }
        break;

      case "cancelled": {
        const rendered = outputRenderer.flush();
        state.output += rendered.text;
        if (rendered.toolCalls) {
          state.toolCalls = rendered.toolCalls;
        }
        if (rendered.segments) {
          state.renderedSegments = rendered.segments;
        }
        state.trailerText = state.trailerText
          ? `${state.trailerText}\n[cancelled]`
          : "[cancelled]";
        state.output += "\n[cancelled]";
        state.wasCancelled = true;
        callbacks.onClearActiveHarnessCallId();
        break;
      }

      case "done": {
        const rendered = outputRenderer.flush();
        state.output += rendered.text;
        if (rendered.toolCalls) {
          state.toolCalls = rendered.toolCalls;
        }
        if (rendered.segments) {
          state.renderedSegments = rendered.segments;
        }
        state.finalExitCode = event.exitCode ?? null;
        state.finalError = event.error ?? null;
        const doneMarker = event.error
          ? `[error: ${event.error}]`
          : event.exitCode === 0
            ? "[done]"
            : `[exit ${event.exitCode ?? "unknown"}]`;
        state.trailerText = state.trailerText
          ? `${state.trailerText}\n${doneMarker}`
          : doneMarker;
        state.output += `\n${doneMarker}`;
        if (event.pullRequestUrl) {
          const pullRequestMarker = `[Open pull request](${event.pullRequestUrl})`;
          state.trailerText = `${state.trailerText}\n${pullRequestMarker}`;
          state.output += `\n${pullRequestMarker}`;
        }
        callbacks.onClearActiveHarnessCallId();
        break;
      }

      case "error": {
        const rendered = outputRenderer.flush();
        state.output += rendered.text;
        if (rendered.toolCalls) {
          state.toolCalls = rendered.toolCalls;
        }
        if (rendered.segments) {
          state.renderedSegments = rendered.segments;
        }
        state.finalError = event.data ?? "[error]";
        const errorMarker = event.data ? `[error: ${event.data}]` : "[error]";
        state.trailerText = state.trailerText
          ? `${state.trailerText}\n${errorMarker}`
          : errorMarker;
        state.output += `\n${errorMarker}`;
        callbacks.onClearActiveHarnessCallId();
        break;
      }
    }
  }

  function flush(): void {
    const flushed = outputRenderer.flush();
    state.output += flushed.text;
    if (flushed.toolCalls) {
      state.toolCalls = flushed.toolCalls;
    }
    if (flushed.segments) {
      state.renderedSegments = flushed.segments;
    }
  }

  function getCurrentUpdate() {
    return {
      text: state.output.trimEnd() || "▸ running...",
      toolCalls: state.toolCalls,
      segments: buildSegments(),
    };
  }

  function getFinalUpdate() {
    const renderedOutput = state.output.trim() || "[no output]";
    return {
      text: renderedOutput,
      toolCalls: state.toolCalls,
      segments: buildSegments(),
    };
  }

  function getResumeFailureMessage() {
    const renderedOutput = state.output.trim() || "[no output]";
    return state.finalError
      ? `${renderedOutput}\n${state.finalError}`
      : renderedOutput;
  }

  return {
    state,
    processEvent,
    flush,
    getCurrentUpdate,
    getFinalUpdate,
    getResumeFailureMessage,
  };
}
