/**
 * Launch policy for mission workers. Owned by the platform, not the
 * coordinator: mission 43f98333 (2026-09-07) lost a 2 vCPU / 4 GB sandbox
 * 56 seconds after resume when five Codex workers, one of them told to
 * "delegate three passes", spawned sub-agents until the VM died.
 */

/** Appended verbatim to every worker prompt before it reaches the harness. */
export const WORKER_NO_DELEGATION_FOOTER =
  "You are a single worker. Do not spawn, delegate to, or coordinate other agents. Do the task yourself in this checkout.";

/**
 * Workers a single sandbox may run at the same time. Raise it when larger
 * VMs are available; spawn_subagent refuses launches past this number.
 */
export const MAX_CONCURRENT_WORKERS_PER_SANDBOX = 2;

/** Idempotent: a prompt that already carries the footer is returned as is. */
export function applyWorkerPromptPolicy(taskPrompt: string): string {
  const trimmed = taskPrompt.trimEnd();
  if (trimmed.endsWith(WORKER_NO_DELEGATION_FOOTER)) return trimmed;
  return `${trimmed}\n\n${WORKER_NO_DELEGATION_FOOTER}`;
}

export function sandboxWorkerLimitMessage(activeWorkers: number): string {
  return `Sandbox already runs ${activeWorkers} workers. Wait for one to finish or start another sandbox.`;
}
