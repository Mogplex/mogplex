import type { ToolExecutionEndEvent } from "ai";

/** Keep the application's completion records independent of SDK event shapes. */
export function toolCompletionEvent(event: ToolExecutionEndEvent) {
  return {
    toolCall: event.toolCall,
    durationMs: event.toolExecutionMs,
    success: event.toolOutput.type === "tool-result",
    output:
      event.toolOutput.type === "tool-result"
        ? event.toolOutput.output
        : undefined,
    error:
      event.toolOutput.type === "tool-error"
        ? event.toolOutput.error
        : undefined,
  };
}
