import type { Command } from "@vercel/sandbox";

/**
 * The Vercel Sandbox API caps a single logs() or wait() request at a few
 * minutes. A detached command keeps running past that cap, so a capped or
 * dropped request means "this request ended", not "the command failed". These
 * are the transient signals we retry across; anything else is a real failure
 * and propagates.
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
  delay?: (ms: number) => Promise<void>;
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
  /** Delay between wait retries once the live stream has been capped. */
  reconnectDelayMs?: number;
};

// The harness worker caps a run at 30 minutes; this backstop sits above that
// so the worker's own timeout fails a genuinely stuck command first.
const DEFAULT_DEADLINE_MS = 40 * 60 * 1000;
const DEFAULT_RECONNECT_DELAY_MS = 3_000;

const defaultDelay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Streams a detached command's logs to `onLog` and returns its exit code.
 *
 * The sandbox caps a single logs or wait request at a few minutes, then serves
 * a snapshot of the command's buffered output rather than a live tail. So the
 * first pass follows the command live until the cap, then completion is
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
  const reconnectDelayMs =
    options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const delay = deps.delay ?? defaultDelay;
  const now = deps.now ?? Date.now;
  const startedAt = now();

  let emitted = 0;
  let attempts = 0;

  const flushLogs = async () => {
    try {
      let index = 0;
      for await (const log of command.logs()) {
        if (index++ < emitted) continue;
        emitted += 1;
        await options.onLog({ stream: log.stream, data: log.data });
      }
    } catch (error) {
      if (!isResumableCommandStreamError(error)) throw error;
    }
  };

  // Follow the command's output live until the request caps or it ends.
  await flushLogs();

  // Establish completion authoritatively with wait(), retrying across caps and
  // flushing any newly buffered output between attempts.
  for (;;) {
    try {
      const result = await command.wait();
      await flushLogs();
      return result.exitCode;
    } catch (error) {
      if (!isResumableCommandStreamError(error)) throw error;
      if (now() - startedAt >= deadlineMs) throw error;
      attempts += 1;
      if (options.onReconnect) {
        await options.onReconnect({ attempt: attempts, error });
      }
      await flushLogs();
      await delay(reconnectDelayMs);
    }
  }
}
