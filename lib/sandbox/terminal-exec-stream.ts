import type { ExecStreamEvent } from "./exec-stream";

export class TerminalExecStreamInterruptedError extends Error {
  constructor() {
    super(
      "Terminal connection ended before command completion. Check the sandbox before retrying."
    );
    this.name = "TerminalExecStreamInterruptedError";
  }
}

function isExecEvent(value: unknown): value is ExecStreamEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  switch (event.type) {
    case "run":
      return typeof event.cmdId === "string";
    case "log":
      return (
        (event.stream === "stdout" || event.stream === "stderr") &&
        typeof event.data === "string"
      );
    case "done":
      return (
        (event.exitCode === null || Number.isInteger(event.exitCode)) &&
        typeof event.cwd === "string"
      );
    case "error":
      return typeof event.data === "string";
    case "cancelled":
      return true;
    default:
      return false;
  }
}

export async function consumeTerminalExecStream(
  response: Response,
  onEvent: (event: ExecStreamEvent) => void
) {
  if (!response.body) throw new Error("Terminal response has no stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        let event: unknown;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (!isExecEvent(event)) continue;
        terminal ||=
          event.type === "done" ||
          event.type === "error" ||
          event.type === "cancelled";
        onEvent(event);
      }
    }
    if (!terminal) throw new TerminalExecStreamInterruptedError();
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
