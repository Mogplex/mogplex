import type { getSandboxByName as getSandbox } from "@/lib/sandbox/sdk-adapter";
import type { updateSandboxRecord } from "@/lib/sandbox/records";
import type {
  getPlatformSandboxCredentials,
  loadUserVercelCredentials,
} from "@/lib/sandbox/get-user-credentials";
import type { resolveCrossUserActiveSandboxLivenessMap } from "@/lib/sandbox/liveness";
import type {
  repairStoppedSandboxHealthStatus,
  StaleStoppedSandboxRecord,
} from "@/lib/sandbox/reaper-helpers";
import type {
  finalizeSandboxBillingClose,
  prepareSandboxBillingClose,
} from "@/lib/billing/sandbox-usage";
import type {
  ReaperSandboxRecord,
  AbandonedPausedSandboxRecord,
  FreshIdleState,
} from "@/lib/sandbox/reaper-types";
import type {
  stopSandbox,
  deleteAbandonedPausedSandbox,
} from "@/lib/sandbox/reaper-stop";

export type SandboxReaperRunnerDeps = {
  loadActiveSandboxes: () => Promise<ReaperSandboxRecord[]>;
  loadStaleStoppedSandboxes: () => Promise<StaleStoppedSandboxRecord[]>;
  loadAbandonedPausedSandboxes: () => Promise<AbandonedPausedSandboxRecord[]>;
  loadBusySandboxIds: () => Promise<Set<string>>;
  getPlatformSandboxCredentials: typeof getPlatformSandboxCredentials;
  loadUserVercelCredentials: typeof loadUserVercelCredentials;
  resolveCrossUserActiveSandboxLivenessMap: typeof resolveCrossUserActiveSandboxLivenessMap;
  repairStoppedSandboxHealthStatus: typeof repairStoppedSandboxHealthStatus;
  stopSandbox: typeof stopSandbox;
  getSandbox: typeof getSandbox;
  deleteAbandonedPausedSandbox: typeof deleteAbandonedPausedSandbox;
  updateSandboxRecord: typeof updateSandboxRecord;
  loadFreshIdleState: (sandboxId: string) => Promise<FreshIdleState | null>;
  prepareSandboxBillingClose: typeof prepareSandboxBillingClose;
  finalizeSandboxBillingClose: typeof finalizeSandboxBillingClose;
  nowMs: () => number;
};
