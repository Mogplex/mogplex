import { describe, expect, it } from "vitest";
import type { Command } from "@vercel/sandbox";
import { APIError, StreamError } from "@vercel/sandbox";
import {
  isResumableCommandStreamError,
  streamCommandLogsWithResume,
} from "./command-stream";

type Line = { stream: "stdout" | "stderr"; data: string };
type LogsStep = { upto: number; throwError?: unknown };
type WaitStep = { exitCode: number } | { throwError: unknown };

/**
 * Builds a fake detached Command. Each logs() call replays the command's whole
 * buffered output from the start (matching the real ndjson endpoint) up to the
 * step's `upto`, then optionally throws to simulate the request being capped.
 * Each wait() call returns or throws per its step; a capped wait() throws a
 * resumable error, a finished command returns its exit code. The last step is
 * reused once its list is exhausted.
 */
function makeCommand(
  logsPlan: LogsStep[],
  allLines: Line[],
  waitPlan: WaitStep[]
) {
  let logsCall = 0;
  let waitCall = 0;
  const command = {
    cmdId: "cmd_test",
    logs() {
      const plan = logsPlan[Math.min(logsCall, logsPlan.length - 1)];
      logsCall += 1;
      const replay = allLines.slice(0, plan.upto);
      async function* gen() {
        for (const line of replay) yield line;
        if (plan.throwError) throw plan.throwError as Error;
      }
      return gen();
    },
    async wait() {
      const plan = waitPlan[Math.min(waitCall, waitPlan.length - 1)];
      waitCall += 1;
      if ("throwError" in plan) throw plan.throwError as Error;
      return { exitCode: plan.exitCode };
    },
  } as unknown as Command;
  return { command, logsCalls: () => logsCall, waitCalls: () => waitCall };
}

describe("isResumableCommandStreamError", () => {
  it.each([408, 429, 500, 502, 503, 504])(
    "does not restart SDK HTTP retries after status %i is surfaced",
    (status) => {
      expect(
        isResumableCommandStreamError(
          new APIError(new Response(null, { status }), {
            message: `Status code ${status} is not ok`,
          })
        )
      ).toBe(false);
    }
  );
  it.each([400, 401, 403, 404, 410, 422])(
    "should reject terminal HTTP %i even when the message resembles a stream failure",
    (status) => {
      expect(
        isResumableCommandStreamError(
          new Error(`Status code ${status} is not ok`)
        )
      ).toBe(false);
      expect(
        isResumableCommandStreamError(
          new APIError(new Response(null, { status }), {
            message: "stream closed",
          })
        )
      ).toBe(false);
    }
  );

  it("should reject a provider stopped-session event and explicit cancellation", () => {
    expect(
      isResumableCommandStreamError(
        new StreamError("sandbox_stopped", "stream ended", "sbx_test")
      )
    ).toBe(false);
    expect(
      isResumableCommandStreamError(new DOMException("aborted", "AbortError"))
    ).toBe(false);
  });
  it("should treat a capped or dropped sandbox request as resumable", () => {
    expect(
      isResumableCommandStreamError(
        new StreamError(
          "stream_ended_early",
          "Stream ended before command finished",
          "sbx_test"
        )
      )
    ).toBe(true);
    expect(isResumableCommandStreamError(new Error("terminated"))).toBe(true);
    expect(isResumableCommandStreamError(new Error("socket hang up"))).toBe(
      true
    );
  });

  it("should not treat an ordinary application error as resumable", () => {
    expect(
      isResumableCommandStreamError(new Error("prompt was rejected"))
    ).toBe(false);
    expect(isResumableCommandStreamError(null)).toBe(false);
  });
});

describe("streamCommandLogsWithResume", () => {
  it("surfaces rate limiting once without issuing further log or wait requests", async () => {
    const error = new APIError(
      new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
      { message: "Status code 429 is not ok" }
    );
    const { command, waitCalls, logsCalls } = makeCommand(
      [{ upto: 0 }],
      [],
      [{ throwError: error }]
    );
    let clock = 0;
    await expect(
      streamCommandLogsWithResume(
        { command, onLog: () => {}, deadlineMs: 1000 },
        { now: () => (clock += 500) }
      )
    ).rejects.toBe(error);
    expect(waitCalls()).toBe(1);
    expect(logsCalls()).toBe(1);
  });
  it("should fail immediately when the sandbox is gone without reconnecting", async () => {
    const gone = new Error("Status code 410 is not ok");
    const { command, waitCalls, logsCalls } = makeCommand(
      [{ upto: 0 }],
      [],
      [{ throwError: gone }]
    );
    let reconnects = 0;
    let clock = 0;
    await expect(
      streamCommandLogsWithResume(
        {
          command,
          onLog: () => {},
          onReconnect: () => {
            reconnects += 1;
          },
          deadlineMs: 1000,
        },
        { now: () => (clock += 500) }
      )
    ).rejects.toBe(gone);
    expect(waitCalls()).toBe(1);
    expect(logsCalls()).toBe(1);
    expect(reconnects).toBe(0);
  });

  it("should not swallow a log consumer failure as a provider connection error", async () => {
    const failure = new Error("fetch failed");
    const { command, waitCalls } = makeCommand(
      [{ upto: 1 }],
      [{ stream: "stdout", data: "work" }],
      [{ exitCode: 0 }]
    );
    await expect(
      streamCommandLogsWithResume({
        command,
        onLog: () => {
          throw failure;
        },
      })
    ).rejects.toBe(failure);
    expect(waitCalls()).toBe(0);
  });

  it("should not retry a consumer failure during the final log drain", async () => {
    const failure = new Error("socket hang up");
    const { command, waitCalls } = makeCommand(
      [{ upto: 0 }, { upto: 1 }],
      [{ stream: "stdout", data: "work" }],
      [{ exitCode: 0 }]
    );
    await expect(
      streamCommandLogsWithResume({
        command,
        onLog: () => {
          throw failure;
        },
        deadlineMs: 0,
      })
    ).rejects.toBe(failure);
    expect(waitCalls()).toBe(1);
  });
  const allLines: Line[] = [
    { stream: "stdout", data: "a" },
    { stream: "stdout", data: "b" },
    { stream: "stderr", data: "c" },
    { stream: "stdout", data: "d" },
    { stream: "stdout", data: "e" },
  ];

  it("should emit each line once when the live stream is capped before completion", async () => {
    // Live stream sends 3 lines then the request is capped; wait() reports the
    // command finished, and the flush after wait picks up the rest.
    const { command } = makeCommand(
      [{ upto: 3, throwError: new Error("terminated") }, { upto: 5 }],
      allLines,
      [{ exitCode: 0 }]
    );
    const seen: Line[] = [];

    const exitCode = await streamCommandLogsWithResume({
      command,
      onLog: (log) => {
        seen.push(log);
      },
    });

    expect(exitCode).toBe(0);
    expect(seen).toEqual(allLines);
  });

  it("should return the exit code from a clean single pass", async () => {
    const only: Line[] = [{ stream: "stdout", data: "only" }];
    const { command, waitCalls } = makeCommand([{ upto: 1 }], only, [
      { exitCode: 0 },
    ]);
    const seen: Line[] = [];

    const exitCode = await streamCommandLogsWithResume({
      command,
      onLog: (log) => {
        seen.push(log);
      },
    });

    expect(exitCode).toBe(0);
    expect(seen).toEqual(only);
    expect(waitCalls()).toBe(1);
  });

  it("should wait across repeated caps until a long command finishes", async () => {
    const lines: Line[] = [
      { stream: "stdout", data: "start" },
      { stream: "stdout", data: "mid" },
      { stream: "stdout", data: "end" },
    ];
    // Live stream caps after one line; wait() reports the command still running
    // (capped) twice, each retry flushing more snapshot output, then it exits.
    const { command, waitCalls } = makeCommand(
      [
        { upto: 1, throwError: new Error("terminated") },
        { upto: 2 },
        { upto: 3 },
        { upto: 3 },
      ],
      lines,
      [
        { throwError: new Error("terminated") },
        { throwError: new Error("terminated") },
        { exitCode: 0 },
      ]
    );
    const seen: Line[] = [];
    const reconnects: number[] = [];

    const exitCode = await streamCommandLogsWithResume({
      command,
      onLog: (log) => {
        seen.push(log);
      },
      onReconnect: ({ attempt }) => {
        reconnects.push(attempt);
      },
    });

    expect(exitCode).toBe(0);
    expect(seen).toEqual(lines);
    expect(reconnects).toEqual([1, 2]);
    expect(waitCalls()).toBe(3);
  });

  it("should rethrow a non-resumable error raised by wait", async () => {
    const { command } = makeCommand(
      [{ upto: 0 }],
      [],
      [{ throwError: new Error("prompt was rejected") }]
    );

    await expect(
      streamCommandLogsWithResume({ command, onLog: () => {} })
    ).rejects.toThrow("prompt was rejected");
  });

  it("should rethrow a non-resumable error raised by the live stream", async () => {
    const { command } = makeCommand(
      [{ upto: 0, throwError: new Error("prompt was rejected") }],
      [],
      [{ exitCode: 0 }]
    );

    await expect(
      streamCommandLogsWithResume({ command, onLog: () => {} })
    ).rejects.toThrow("prompt was rejected");
  });

  it("should fail a still-running command once the wall-clock deadline passes", async () => {
    const { command } = makeCommand(
      [{ upto: 0 }],
      [],
      [{ throwError: new Error("terminated") }]
    );
    let clock = 0;

    await expect(
      streamCommandLogsWithResume(
        {
          command,
          onLog: () => {},
          deadlineMs: 1_000,
        },
        {
          now: () => {
            clock += 600;
            return clock;
          },
        }
      )
    ).rejects.toThrow("terminated");
  });
});
