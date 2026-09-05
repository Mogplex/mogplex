import type { Command } from "@vercel/sandbox";
import { APIError, StreamError } from "@vercel/sandbox";

/**
 * A detached command can outlive a dropped logs() or wait() connection.
 * A transport interruption means "this request ended", not "the command failed". These
 * are the transient signals we retry across; anything else is a real failure
 * and propagates.
 */
export function isResumableCommandStreamError(error: unknown): boolean {
  if (!error) return false;
  // Provider lifecycle/status codes take precedence over vague text such as
  // "stream ended". A stopped session cannot execute its command again.
  if (error instanceof StreamError) return error.code === "stream_ended_early";
  if (error instanceof Error && error.name === "AbortError") return false;
  const message = error instanceof Error ? error.message : String(error);
  const status =
    error instanceof APIError
      ? error.response.status
      : Number(/status code (\d{3}) is not ok/i.exec(message)?.[1]);
  if (Number.isFinite(status))
    return [408, 429, 500, 502, 503, 504].includes(status);
  return /stream (?:closed|ended)|socket hang up|other side closed|econnreset|epipe|etimedout|terminated|premature close|network (?:error|timeout)|fetch failed/i.test(
    message
  );
}

export type CommandLogLine = { stream: "stdout" | "stderr"; data: string };

export type StreamCommandLogsDeps = {
  now?: () => number;
};

export type StreamCommandLogsOptions = {
  command: Command;
  onLog: (log: CommandLogLine) => Promise<void> | void;
  onReconnect?: (info: {
    attempt: number;
    error: unknown;
  }) => Promise<void> | void;
  /**
   * Wall-clock budget for the whole run. Once exceeded, a command still not
   * finished is failed. Keep this at or above the caller's own run timeout so
   * that timeout fires first for a genuinely stuck command.
   */
  deadlineMs?: number;
};

// The harness worker caps a run at 30 minutes; this backstop sits above that
// so the worker's own timeout fails a genuinely stuck command first.
const DEFAULT_DEADLINE_MS = 40 * 60 * 1000;

/**
 * Streams a detached command's logs to `onLog` and returns its exit code.
 *
 * The first pass follows the command's logs until that stream ends; completion is
 * established with command.wait(), which is retried across further caps while
 * new snapshot output is flushed between attempts. Completion must come from
 * wait(): a capped logs stream ends without an exit code, and a finished
 * detached command is only reliably reported by wait(). Output is
 * de-duplicated by position, because each connection replays from the start.
 *
 * Retries continue until the command finishes or the wall-clock deadline is
 * reached, so a run legitimately longer than the request cap is never
 * abandoned.
 */
export async function streamCommandLogsWithResume(
  options: StreamCommandLogsOptions,
  deps: StreamCommandLogsDeps = {}
): Promise<number> {
  const { command } = options;
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const now = deps.now ?? Date.now;
  const startedAt = now();

  let emitted = 0;
  let attempts = 0;

  const flushLogs = async () => {
    const iterator = command.logs()[Symbol.asyncIterator]();
    try {
      let index = 0;
      for (;;) {
        let next: IteratorResult<CommandLogLine>;
        try {
          next = await iterator.next();
        } catch (error) {
          if (!isResumableCommandStreamError(error)) throw error;
          return;
        }
        if (next.done) return;
        if (index++ < emitted) continue;
        // Consumer failures (DB writes, leases, disconnected SSE clients) are
        // not provider transport failures and must never be swallowed.
        await options.onLog(next.value);
        emitted += 1;
      }
    } finally {
      await iterator.return?.();
    }
  };

  // Follow the command's output live until the request caps or it ends.
  await flushLogs();

  // Establish completion authoritatively with wait(), retrying across caps and
  // flushing any newly buffered output between attempts.
  for (;;) {
    let exitCode: number;
    try {
      const result = await command.wait();
      exitCode = result.exitCode;
    } catch (error) {
      if (!isResumableCommandStreamError(error)) throw error;
      if (now() - startedAt >= deadlineMs) throw error;
      attempts += 1;
      if (options.onReconnect) {
        await options.onReconnect({ attempt: attempts, error });
      }
      await flushLogs();
      // Reattach the provider's blocking completion request when its transport
      // ends. No timer-driven status checks and no command restart.
      continue;
    }
    await flushLogs();
    return exitCode;
  }
}
