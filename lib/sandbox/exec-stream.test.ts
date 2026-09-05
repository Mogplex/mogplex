import { afterEach, expect, it, vi } from "vitest";
import { startExecStream } from "./exec-stream";

afterEach(() => vi.useRealTimers());

function fixture(fail = false) {
  let finish!: () => void;
  const completion = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const command = {
    cmdId: "quiet-command",
    logs: vi.fn(async function* logs() {
      await completion;
      if (fail) throw new Error("Provider stopped");
      yield { stream: "stdout" as const, data: "finished" };
    }),
    wait: vi.fn(async () => ({ exitCode: 0 })),
    kill: vi.fn(async () => finish()),
  };
  const runCommand = vi.fn(async () => command);
  const onComplete = vi.fn();
  const onActivity = vi.fn();
  return {
    finish,
    command,
    runCommand,
    onComplete,
    onActivity,
    response: () =>
      startExecStream({
        sandbox: { runCommand } as never,
        run: { kind: "shell", command: "quiet-work" },
        cwd: undefined,
        env: {},
        reportedCwd: ".",
        onComplete,
        onActivity,
      }),
  };
}

it.each([false, true])(
  "keeps a quiet connection alive without polling and clears keepalive after failure=%s",
  async (fail) => {
    vi.useFakeTimers();
    const f = fixture(fail);
    const response = await f.response();
    let output = "";
    const consume = (async () => {
      const reader = response.body!.getReader();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        output += new TextDecoder().decode(chunk.value);
      }
    })();
    try {
      await vi.advanceTimersByTimeAsync(330_000);
      expect(output).toContain(": keepalive\n\n");
      expect(f.runCommand).toHaveBeenCalledTimes(1);
      expect(f.command.logs).toHaveBeenCalledTimes(1);
      expect(f.command.wait).not.toHaveBeenCalled();
      expect(f.onActivity).not.toHaveBeenCalled();
    } finally {
      f.finish();
      await consume;
    }
    expect(output).toContain(fail ? '"type":"error"' : '"type":"done"');
    expect(f.onComplete).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  }
);

it("cancellation clears keepalive and releases the command without writing to a closed stream", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const response = await f.response();
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(f.command.kill).toHaveBeenCalledTimes(1);
  expect(f.onComplete).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
