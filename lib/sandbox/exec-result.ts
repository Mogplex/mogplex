import type { Sandbox } from "@vercel/sandbox";
import { observeShellCommand } from "./observed-shell";

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
  const result = await sandbox.runCommand({
    cmd: input.args ? input.command : (observed?.cmd ?? "sh"),
    args: input.args ?? observed?.args ?? ["-lc", input.command],
    cwd: input.cwd,
    env: input.env,
    ...(input.onStarted ? { detached: true } : {}),
  });
  let exitCode = result.exitCode;
  let removeAbort = () => {};
  if (input.onStarted) {
    try {
      await input.onStarted(result.cmdId);
      const abort = () => {
        void result.kill().catch(() => undefined);
      };
      input.signal?.addEventListener("abort", abort, { once: true });
      removeAbort = () => input.signal?.removeEventListener("abort", abort);
      if (input.signal?.aborted) abort();
      exitCode = (await result.wait()).exitCode;
      await input.onFinished?.(result.cmdId);
      input.signal?.throwIfAborted();
    } catch (error) {
      await result.kill().catch(() => undefined);
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
