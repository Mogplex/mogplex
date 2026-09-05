import type { Sandbox } from "@vercel/sandbox";
import { redactSecretsInText } from "@/lib/ai-telemetry";
import { streamCommandLogsWithResume } from "@/lib/sandbox/command-stream";

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
  /** Invoked when command output proves the sandbox is still active. */
  onActivity?: () => Promise<void> | void;
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
  const { sandbox, run, cwd, env, reportedCwd, onComplete, onActivity } = opts;

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
  let closed = false;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  const clearKeepalive = () => {
    if (keepalive) clearInterval(keepalive);
    keepalive = undefined;
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ExecStreamEvent) => {
        if (!closed) controller.enqueue(encoder.encode(encode(event)));
      };
      try {
        send({ type: "run", cmdId: detachedCmd.cmdId });
        // Transport-only heartbeat: no provider/DB reads, activity renewal or
        // status polling. Quiet HTTP/1.1 connections otherwise expire.
        keepalive = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": keepalive\n\n"));
        }, 15_000);
        keepalive.unref?.();

        const exitCode = await streamCommandLogsWithResume({
          command: detachedCmd,
          onLog: async (log) => {
            if (onActivity) await onActivity();
            send({
              type: "log",
              stream: log.stream,
              data: redactSecretsInText(log.data),
            });
          },
        });

        const exit = { exitCode };

        if (killed) {
          send({ type: "cancelled" });
        } else {
          send({ type: "done", exitCode: exit.exitCode, cwd: reportedCwd });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "stream error";
        send({ type: "error", data: redactSecretsInText(message) });
      } finally {
        clearKeepalive();
        if (!closed) {
          closed = true;
          controller.close();
        }
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
      closed = true;
      clearKeepalive();
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
