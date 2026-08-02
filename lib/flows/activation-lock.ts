import { FlowServiceError } from "@/lib/flows/errors";

export type FlowActivationLockResult =
  | { acquired: true; token: string }
  | { acquired: false; reason: "in_progress" | "not_found" };

export type FlowActivationLockRow = {
  flow_id: string;
  lock_token: string;
  locked_at: string;
};

type FlowActivationLockAcquireDeps = {
  load: (flowId: string) => Promise<FlowActivationLockRow | null>;
  insert: (
    flowId: string,
    token: string,
    lockedAt: string
  ) => Promise<FlowActivationLockResult>;
  createToken: () => string;
  now: () => Date;
};

type FlowActivationLockDeps = {
  acquire: (flowId: string) => Promise<FlowActivationLockResult>;
  release: (flowId: string, token: string) => Promise<boolean>;
  reportReleaseError: (error: unknown) => void;
};

async function getSupabaseAdmin() {
  return (await import("@/lib/supabase/admin")).supabaseAdmin;
}

async function loadFlowActivationLock(flowId: string) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("flow_activation_locks")
    .select("flow_id, lock_token, locked_at")
    .eq("flow_id", flowId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load workflow activation lock: ${error.message}`
    );
  }

  return data as FlowActivationLockRow | null;
}

async function insertFlowActivationLock(
  flowId: string,
  token: string,
  lockedAt: string
): Promise<FlowActivationLockResult> {
  const supabaseAdmin = await getSupabaseAdmin();
  const { error } = await supabaseAdmin.from("flow_activation_locks").insert({
    flow_id: flowId,
    lock_token: token,
    locked_at: lockedAt,
  });
  if (error?.code === "23505") {
    return { acquired: false, reason: "in_progress" };
  }
  if (error?.code === "23503") {
    return { acquired: false, reason: "not_found" };
  }
  if (error) {
    throw new Error(
      `Failed to acquire workflow activation lock: ${error.message}`
    );
  }
  return { acquired: true, token };
}

export async function acquireFlowActivationLock(
  flowId: string,
  overrides: Partial<FlowActivationLockAcquireDeps> = {}
): Promise<FlowActivationLockResult> {
  const deps: FlowActivationLockAcquireDeps = {
    load: loadFlowActivationLock,
    insert: insertFlowActivationLock,
    createToken: () => crypto.randomUUID(),
    now: () => new Date(),
    ...overrides,
  };
  const current = await deps.load(flowId);
  // Never replace an existing token based on elapsed time. The protected
  // Trigger.dev request has no timeout, so only its holder may release it.
  if (current) {
    return { acquired: false, reason: "in_progress" };
  }

  const token = deps.createToken();
  return deps.insert(flowId, token, deps.now().toISOString());
}

export async function releaseFlowActivationLock(flowId: string, token: string) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("flow_activation_locks")
    .delete()
    .eq("flow_id", flowId)
    .eq("lock_token", token)
    .select("flow_id")
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to release workflow activation lock: ${error.message}`
    );
  }
  return Boolean(data);
}

export async function runWithFlowActivationLock<T>(
  flowId: string,
  operation: () => Promise<T>,
  overrides: Partial<FlowActivationLockDeps> = {}
) {
  const deps: FlowActivationLockDeps = {
    acquire: acquireFlowActivationLock,
    release: releaseFlowActivationLock,
    reportReleaseError: (error) => {
      console.error("[flow-activation] Failed to release lock", error);
    },
    ...overrides,
  };

  let lock: FlowActivationLockResult;
  try {
    lock = await deps.acquire(flowId);
  } catch (error) {
    throw new FlowServiceError(
      "FLOW_STORAGE_FAILED",
      "Failed to acquire the workflow activation lock.",
      { cause: error }
    );
  }

  if (!lock.acquired) {
    if (lock.reason === "not_found") {
      throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
    }
    throw new FlowServiceError(
      "FLOW_ACTIVATION_IN_PROGRESS",
      "This workflow is already being paused or resumed. Please try again."
    );
  }

  try {
    return await operation();
  } finally {
    try {
      const released = await deps.release(flowId, lock.token);
      if (!released) {
        deps.reportReleaseError(
          new Error("Workflow activation lock ownership changed before release")
        );
      }
    } catch (error) {
      deps.reportReleaseError(error);
    }
  }
}
