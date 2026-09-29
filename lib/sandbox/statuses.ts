import type { SandboxLifecycleStatus } from "@/lib/types";

export const ACTIVE_SANDBOX_STATUSES = [
  "creating",
  "installing",
  "running",
  "pausing",
] as const satisfies readonly SandboxLifecycleStatus[];

/** Statuses a record holds while its boot is still running, VM up or not. */
export const BOOTING_SANDBOX_STATUSES = [
  "creating",
  "installing",
] as const satisfies readonly SandboxLifecycleStatus[];

const BOOTING_STATUSES: ReadonlySet<string> = new Set(BOOTING_SANDBOX_STATUSES);

/** Whether a record's boot (clone, branch push, installs) has not finished. */
export function isBootingSandboxStatus(status: string) {
  return BOOTING_STATUSES.has(status);
}
