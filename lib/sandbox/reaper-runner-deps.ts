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
  FreshIdleState,
} from "@/lib/sandbox/reaper-types";
import type { stopSandbox } from "@/lib/sandbox/reaper-stop";
import type { withSupabaseAdminConnection } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SandboxReaperRunnerDeps = {
  withSupabaseAdminConnection: typeof withSupabaseAdminConnection;
  loadActiveSandboxes: (
    client?: SupabaseClient
  ) => Promise<ReaperSandboxRecord[]>;
  loadStaleStoppedSandboxes: (
    client?: SupabaseClient
  ) => Promise<StaleStoppedSandboxRecord[]>;
  loadBusySandboxIds: () => Promise<Set<string>>;
  getPlatformSandboxCredentials: typeof getPlatformSandboxCredentials;
  loadUserVercelCredentials: typeof loadUserVercelCredentials;
  resolveCrossUserActiveSandboxLivenessMap: typeof resolveCrossUserActiveSandboxLivenessMap;
  repairStoppedSandboxHealthStatus: typeof repairStoppedSandboxHealthStatus;
  stopSandbox: typeof stopSandbox;
  getSandbox: typeof getSandbox;
  updateSandboxRecord: typeof updateSandboxRecord;
  loadFreshIdleState: (sandboxId: string) => Promise<FreshIdleState | null>;
  prepareSandboxBillingClose: typeof prepareSandboxBillingClose;
  finalizeSandboxBillingClose: typeof finalizeSandboxBillingClose;
  nowMs: () => number;
};
