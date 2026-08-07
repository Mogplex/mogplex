/**
 * Shared fixtures and helpers for sandbox-auto-pause tests.
 */

export async function loadAutoPauseModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../lib/sandbox/auto-pause");
}

export type AutoPausePayload = {
  sandboxRecordId: string;
  sandboxId: string;
  userId: string;
  tabId: string;
  sessionId: string;
  releasedAt: string;
  releaseEventId: string;
  gracePeriodMs: number;
};

export type AutoPauseRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  status: string;
  health_status: string | null;
  exec_lock_token: string | null;
  persistent: boolean | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
};

export type ReleaseRpcResult = {
  session_row_id?: string | null;
  applied?: boolean | null;
  should_queue?: boolean | null;
  released_at?: string | null;
  release_event_id?: string | null;
};

export const nowMs = Date.parse("2026-05-20T12:00:00.000Z");
export const releasedAt = new Date(nowMs - 91_000).toISOString();
export const sandboxRecordId = "11111111-1111-4111-8111-111111111111";

export function buildPayload(
  overrides: Partial<AutoPausePayload> = {}
): AutoPausePayload {
  return {
    sandboxRecordId,
    sandboxId: "vm_123",
    userId: "user-1",
    tabId: "tab-1",
    sessionId: "session-1",
    releasedAt,
    releaseEventId: "event-release-1",
    gracePeriodMs: 90_000,
    ...overrides,
  };
}

export function buildRecord(
  overrides: Partial<AutoPauseRecord> = {}
): AutoPauseRecord {
  return {
    id: sandboxRecordId,
    user_id: "user-1",
    repo_id: "repo-1",
    sandbox_id: "vm_123",
    status: "running",
    health_status: "running",
    exec_lock_token: null,
    persistent: true,
    billing_source: "platform",
    billing_team_id: null,
    billing_project_id: "project-1",
    vercel_team_id: null,
    vercel_project_id: "project-1",
    ...overrides,
  };
}

export function buildDeps(
  input: {
    record?: AutoPauseRecord | null;
    activeSessionCount?: number;
    newerSessionEventCount?: number;
    activeAiCall?: boolean;
    activeAiCallSequence?: boolean[];
    runningAutomation?: boolean;
    claimResult?: boolean;
    billingCloseError?: Error;
    stopError?: Error;
    mode?: "observe" | "enabled";
    updateResult?: unknown;
    currentSnapshotId?: string | null;
  } = {}
) {
  const events: Array<{
    eventType: string;
    decisionCode?: string | null;
    payload?: Record<string, unknown>;
  }> = [];
  const updates: Array<{
    updates: Record<string, unknown>;
    options: Record<string, unknown>;
  }> = [];
  const claims: Array<{
    sandboxRecordId: string;
    sandboxId: string;
    releasedAt: string;
  }> = [];
  let stopCalls = 0;
  let activeAiCallChecks = 0;

  return {
    events,
    updates,
    claims,
    get stopCalls() {
      return stopCalls;
    },
    deps: {
      loadSandboxRecord: async () =>
        input.record === undefined ? buildRecord() : input.record,
      loadPresenceState: async () => ({
        activeSessionCount: input.activeSessionCount ?? 0,
        newerSessionEventCount: input.newerSessionEventCount ?? 0,
      }),
      hasActiveAiCall: async () => {
        const next =
          input.activeAiCallSequence?.[
            Math.min(activeAiCallChecks, input.activeAiCallSequence.length - 1)
          ] ?? input.activeAiCall;
        activeAiCallChecks += 1;
        return next ?? false;
      },
      hasRunningAutomation: async () => input.runningAutomation ?? false,
      claimAutoPause: async (claimInput: {
        sandboxRecordId: string;
        sandboxId: string;
        releasedAt: string;
      }) => {
        claims.push(claimInput);
        return input.claimResult ?? true;
      },
      resolveVmCredentials: async () => ({
        vercelToken: "token",
        vercelTeamId: null,
        vercelProjectId: "project-1",
      }),
      getSandbox: async () =>
        ({
          stop: async () => {
            stopCalls += 1;
            if (input.stopError) throw input.stopError;
          },
          currentSession: () => ({
            updatedAt: new Date("2026-05-20T12:05:00.000Z"),
          }),
          currentSnapshotId: Object.hasOwn(input, "currentSnapshotId")
            ? input.currentSnapshotId
            : "snap_123",
        }) as never,
      updateSandboxRecord: async (
        _id: string,
        nextUpdates: Record<string, unknown>,
        options: Record<string, unknown>
      ) => {
        updates.push({ updates: nextUpdates, options });
        return (
          Object.hasOwn(input, "updateResult")
            ? input.updateResult
            : { id: sandboxRecordId }
        ) as never;
      },
      recordLifecycleEvent: async (event: {
        eventType: string;
        decisionCode?: string | null;
        payload?: Record<string, unknown>;
      }) => {
        events.push(event);
        return `event-${events.length}`;
      },
      prepareSandboxBillingClose: async () => {
        if (input.billingCloseError) throw input.billingCloseError;
        return null;
      },
      finalizeSandboxBillingClose: async () => ({
        finalized: false,
        metered: false,
      }),
      resolveMode: () => input.mode ?? "observe",
      nowMs: () => nowMs,
    },
  };
}

export function createReleaseRpcClient(input: {
  rpcResults: ReleaseRpcResult[];
}) {
  const state = {
    rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  };
  let rpcIndex = 0;

  return {
    state,
    client: {
      async rpc(name: string, args: Record<string, unknown>) {
        state.rpcCalls.push({ name, args });
        return {
          data: [input.rpcResults[rpcIndex++] ?? null],
          error: null,
        };
      },
    },
  };
}
