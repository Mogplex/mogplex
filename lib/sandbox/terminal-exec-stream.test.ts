import { expect, it, vi } from "vitest";
import { consumeTerminalExecStream } from "./terminal-exec-stream";
import type { ExecStreamEvent } from "./exec-stream";

function response(parts: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts)
          controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    })
  );
}

it("reports premature EOF instead of treating a run frame as completion", async () => {
  await expect(
    consumeTerminalExecStream(
      response(['data: {"type":"run","cmdId":"cmd-1"}\n\n', ": keepalive\n\n"]),
      () => {}
    )
  ).rejects.toThrow("before command completion");
});

it.each([
  { type: "done", exitCode: 0, cwd: "." },
  { type: "error", data: "Provider unavailable" },
  { type: "cancelled" },
] satisfies ExecStreamEvent[])(
  "recognizes terminal event $type across partial chunks and keepalives",
  async (terminal) => {
    const events: ExecStreamEvent[] = [];
    await consumeTerminalExecStream(
      response([
        ': keepalive\r\n\r\ndata: {"type":"ru',
        'n","cmdId":"cmd-1"}\r\n\r\n',
        `data: ${JSON.stringify(terminal)}\n\n`,
      ]),
      (event) => {
        events.push(event);
      }
    );
    expect(events).toEqual([{ type: "run", cmdId: "cmd-1" }, terminal]);
  }
);

it("does not accept a malformed done event as command completion", async () => {
  await expect(
    consumeTerminalExecStream(
      response(['data: {"type":"done","exitCode":"success"}\n\n']),
      () => {}
    )
  ).rejects.toThrow("before command completion");
});

it("ignores malformed and unknown frames but delivers valid output and unknown exit codes", async () => {
  const events: ExecStreamEvent[] = [];
  await consumeTerminalExecStream(
    response([
      'data: not-json\n\ndata: null\n\ndata: {"type":"other"}\n\n',
      'data: {"type":"log","stream":"stdout","data":"hello"}\n\n',
      'data: {"type":"done",\ndata: "exitCode":null,"cwd":"/workspace"}\n\n',
    ]),
    (event) => {
      events.push(event);
    }
  );
  expect(events).toEqual([
    { type: "log", stream: "stdout", data: "hello" },
    { type: "done", exitCode: null, cwd: "/workspace" },
  ]);
});

it("rejects a missing body", async () => {
  await expect(
    consumeTerminalExecStream(new Response(null), () => {})
  ).rejects.toThrow("no stream");
});

it("cancels and releases the reader if its consumer fails", async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode('data: {"type":"run","cmdId":"cmd-1"}\n\n')
      );
    },
    cancel,
  });
  await expect(
    consumeTerminalExecStream(new Response(stream), () => {
      throw new Error("consumer failed");
    })
  ).rejects.toThrow("consumer failed");
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
});
