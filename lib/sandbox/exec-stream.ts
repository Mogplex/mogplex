import type { Sandbox } from "@vercel/sandbox";

export type ExecStreamEvent =
  | { type: "run"; cmdId: string }
  | { type: "log"; stream: "stdout" | "stderr"; data: string }
  | { type: "done"; exitCode: number | null; cwd: string }
  | { type: "cancelled" }
  | { type: "error"; data: string };

type RunSpec =
  | { kind: "raw"; cmd: string; args: string[] }
  | { kind: "shell"; command: string };

export type StartExecStreamOptions = {
  sandbox: Sandbox;
  run: RunSpec;
  cwd: string | undefined;
  env: Record<string, string>;
  /** The cwd sent back in the `done` event if the command didn't change dirs. */
  reportedCwd: string;
  /** Invoked when the stream completes — for releasing exec locks etc. */
  onComplete?: () => Promise<void> | void;
};

function encode(event: ExecStreamEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// Wraps a detached runCommand in a ReadableStream of SSE frames. The client
// sees `run` (with cmdId for cancellation), a stream of `log` chunks in real
// time, and a terminal `done`/`cancelled`/`error` event.
export async function startExecStream(
  opts: StartExecStreamOptions
): Promise<Response> {
  const { sandbox, run, cwd, env, reportedCwd, onComplete } = opts;

  const detachedCmd =
    run.kind === "raw"
      ? await sandbox.runCommand({
          cmd: run.cmd,
          args: run.args,
          cwd,
          env,
          detached: true,
        })
      : await sandbox.runCommand({
          cmd: "sh",
          args: ["-lc", run.command],
          cwd,
          env,
          detached: true,
        });

  const encoder = new TextEncoder();
  let killed = false;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(encode({ type: "run", cmdId: detachedCmd.cmdId }))
        );

        for await (const log of detachedCmd.logs()) {
          controller.enqueue(
            encoder.encode(
              encode({ type: "log", stream: log.stream, data: log.data })
            )
          );
        }

        const exit = await detachedCmd.wait();

        if (killed) {
          controller.enqueue(encoder.encode(encode({ type: "cancelled" })));
        } else {
          controller.enqueue(
            encoder.encode(
              encode({
                type: "done",
                exitCode: exit.exitCode,
                cwd: reportedCwd,
              })
            )
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "stream error";
        controller.enqueue(
          encoder.encode(encode({ type: "error", data: message }))
        );
      } finally {
        controller.close();
        if (onComplete) {
          try {
            await onComplete();
          } catch (error) {
            console.warn("[sandbox/exec] onComplete hook failed", { error });
          }
        }
      }
    },
    async cancel() {
      killed = true;
      try {
        await detachedCmd.kill();
      } catch {
        // Already exited or uncontactable; nothing to do.
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Exec-Cmd-Id": detachedCmd.cmdId,
    },
  });
}
