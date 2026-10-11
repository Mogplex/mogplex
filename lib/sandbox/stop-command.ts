import type { Command } from "@vercel/sandbox";

/** A signal acknowledgement is not proof of termination. The supervisor exits
 * only after its descendants are gone; wait for that exit before settling Stop.
 */
export async function stopSandboxCommand(
  command: Pick<Command, "kill" | "wait" | "exitCode">
) {
  const signal = AbortSignal.timeout(15_000);
  if (command.exitCode == null) {
    try {
      await command.kill("SIGTERM", { abortSignal: signal });
    } catch {
      // The worker and cancellation endpoint can race to stop the same command.
      // Only a confirmed exit makes a failed/duplicate signal harmless.
    }
  }
  await command.wait({ signal });
}
