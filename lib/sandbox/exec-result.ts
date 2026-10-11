import type { Command, Sandbox } from "@vercel/sandbox";
import { observeShellCommand } from "./observed-shell";
import { superviseSandboxCommand } from "./command-supervisor";
import { stopSandboxCommand } from "./stop-command";

export async function executeSandboxCommand(
  sandbox: Sandbox,
  input: {
    command: string;
    args?: string[];
    cwd: string;
    env: Record<string, string>;
    captureFailures?: boolean;
    onStarted?: (commandId: string) => Promise<void>;
    onFinished?: (commandId: string) => Promise<void>;
    signal?: AbortSignal;
  }
) {
  const observed =
    !input.args && input.captureFailures
      ? observeShellCommand(input.command)
      : null;
  const cmd = input.args ? input.command : (observed?.cmd ?? "sh");
  const args = input.args ?? observed?.args ?? ["-lc", input.command];
  input.signal?.throwIfAborted();
  const result: Command = await sandbox.runCommand({
    ...(input.onStarted ? superviseSandboxCommand(cmd, args) : { cmd, args }),
    cwd: input.cwd,
    env: input.env,
    ...(input.onStarted ? { detached: true } : {}),
  });
  let exitCode = result.exitCode;
  let removeAbort = () => {};
  if (input.onStarted) {
    let stopping: Promise<void> | undefined;
    const stop = () => (stopping ??= stopSandboxCommand(result));
    try {
      const abort = () => {
        void stop().catch(() => undefined);
      };
      input.signal?.addEventListener("abort", abort, { once: true });
      removeAbort = () => input.signal?.removeEventListener("abort", abort);
      if (input.signal?.aborted) abort();
      await input.onStarted(result.cmdId);
      exitCode = (await result.wait({ signal: input.signal })).exitCode;
      await stopping;
      input.signal?.throwIfAborted();
      await input.onFinished?.(result.cmdId);
    } catch (error) {
      await stop();
      throw error;
    } finally {
      removeAbort();
    }
  }
  const [stdout, stderr] = await Promise.all([
    result.stdout(),
    result.stderr(),
  ]);
  return {
    exitCode,
    stdout,
    stderr: observed ? observed.stderr(stderr, true) : stderr,
    ...(observed ? { failures: observed.failures } : {}),
    cwd: input.cwd,
  };
}
