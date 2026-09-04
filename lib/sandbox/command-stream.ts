import type { Command } from "@vercel/sandbox";

/**
 * The Vercel Sandbox API caps a single logs() or wait() request at a few
 * minutes. A detached command keeps running past that cap, so a capped or
 * dropped streaming request means "this request ended", not "the command
 * failed". These are the transient signals we reconnect from; anything else
 * is a real failure and propagates.
 */
export function isResumableCommandStreamError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /status code (?:4\d\d|5\d\d) is not ok|stream (?:closed|ended|error)|socket hang up|other side closed|econnreset|epipe|etimedout|terminated|aborted|premature close|network (?:error|timeout)|fetch failed|expected a stream of logs|no response body/i.test(
    message
  );
}

export type CommandLogLine = { stream: "stdout" | "stderr"; data: string };

export type StreamCommandLogsDeps = {
  /**
   * Fresh command status. Returns the exit code once the command has
   * finished, or null while it is still running.
   */
  getExitCode: (cmdId: string) => Promise<number | null>;
  delay?: (ms: number) => Promise<void>;
};

export type StreamCommandLogsOptions = {
  command: Command;
  onLog: (log: CommandLogLine) => Promise<void> | void;
  onReconnect?: (info: {
    attempt: number;
    error: unknown;
  }) => Promise<void> | void;
  /** Reconnect ceiling before giving up. */
  maxReconnects?: number;
  reconnectDelayMs?: number;
};

// A worker run may span ~30 minutes; with a multi-minute cap per request this
// ceiling leaves generous headroom before a genuinely stuck stream is failed.
const DEFAULT_MAX_RECONNECTS = 60;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;

const defaultDelay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Streams a detached command's logs to `onLog` and returns its exit code,
 * reconnecting when the sandbox caps or drops the streaming request before
 * the command finishes.
 *
 * The logs endpoint replays a command's buffered output from the start on
 * every connection, so lines are de-duplicated by position: only lines beyond
 * the count already emitted are forwarded. Completion is detected out of band
 * via `getExitCode`, because a capped request never delivers the final
 * `wait()` result.
 */
export async function streamCommandLogsWithResume(
  options: StreamCommandLogsOptions,
  deps: StreamCommandLogsDeps
): Promise<number> {
  const { command } = options;
  const maxReconnects = options.maxReconnects ?? DEFAULT_MAX_RECONNECTS;
  const reconnectDelayMs =
    options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const delay = deps.delay ?? defaultDelay;

  let emitted = 0;
  let reconnects = 0;

  for (;;) {
    let streamError: unknown = null;
    try {
      let index = 0;
      for await (const log of command.logs()) {
        if (index++ < emitted) continue;
        emitted += 1;
        await options.onLog({ stream: log.stream, data: log.data });
      }
    } catch (error) {
      if (!isResumableCommandStreamError(error)) throw error;
      streamError = error;
    }

    const exitCode = await deps.getExitCode(command.cmdId);
    if (exitCode !== null) return exitCode;

    reconnects += 1;
    if (reconnects > maxReconnects) {
      if (streamError instanceof Error) throw streamError;
      throw new Error(
        typeof streamError === "string" && streamError
          ? streamError
          : "Sandbox command stream ended before the command completed"
      );
    }
    if (options.onReconnect) {
      await options.onReconnect({ attempt: reconnects, error: streamError });
    }
    await delay(reconnectDelayMs);
  }
}
