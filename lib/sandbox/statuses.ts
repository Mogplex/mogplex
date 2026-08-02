import type { SandboxLifecycleStatus } from "@/lib/types";

export const ACTIVE_SANDBOX_STATUSES = [
  "creating",
  "installing",
  "running",
  "pausing",
] as const satisfies readonly SandboxLifecycleStatus[];
