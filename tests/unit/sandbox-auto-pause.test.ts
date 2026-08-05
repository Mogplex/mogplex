import assert from "node:assert/strict";
import test from "node:test";

async function loadAutoPauseModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/auto-pause");
}

type AutoPausePayload = {
  sandboxRecordId: string;
  sandboxId: string;
  userId: string;
  tabId: string;
  sessionId: string;
  releasedAt: string;
  releaseEventId: string;
  gracePeriodMs: number;
};

type AutoPauseRecord = {
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

const nowMs = Date.parse("2026-05-20T12:00:00.000Z");
const releasedAt = new Date(nowMs - 91_000).toISOString();
const sandboxRecordId = "11111111-1111-4111-8111-111111111111";

function buildPayload(
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

function buildRecord(
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

function buildDeps(
  input: {
    record?: AutoPauseRecord | null;
    activeSessionCount?: number;
    newerSessionEventCount?: number;
    activeAiCall?: boolean;
    activeAiCallSequence?: boolean[];
    runningAutomation?: boolean;
    claimResult?: boolean;
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
      resolveMode: () => input.mode ?? "observe",
      nowMs: () => nowMs,
    },
  };
}

type ReleaseRpcResult = {
  session_row_id?: string | null;
  applied?: boolean | null;
  should_queue?: boolean | null;
  released_at?: string | null;
  release_event_id?: string | null;
};

function createReleaseRpcClient(input: { rpcResults: ReleaseRpcResult[] }) {
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

test("active AI-call metadata filter covers chat and sandbox-record keys", async () => {
  const { buildActiveAiCallSandboxMetadataFilter } =
    await loadAutoPauseModule();

  assert.equal(
    buildActiveAiCallSandboxMetadataFilter(sandboxRecordId, "vm_123"),
    `metadata->>sandbox_record_id.eq.${sandboxRecordId},metadata->>sandbox_id.eq.${sandboxRecordId},metadata->>sandbox_id.eq.vm_123`
  );
});

test("active AI-call metadata filter rejects non-UUID ids", async () => {
  const { buildActiveAiCallSandboxMetadataFilter } =
    await loadAutoPauseModule();

  assert.throws(
    () => buildActiveAiCallSandboxMetadataFilter("sandbox-record-1"),
    /sandboxRecordId must be a UUID/
  );
  assert.throws(
    () => buildActiveAiCallSandboxMetadataFilter(sandboxRecordId, "vm 123"),
    /sandboxId has unsupported metadata filter characters/
  );
});

test("recordSandboxClientRelease issues fresh release events per applied release and reuses retry ids", async () => {
  const { state, client } = createReleaseRpcClient({
    rpcResults: [
      {
        session_row_id: "presence-row-1",
        applied: true,
        should_queue: true,
        released_at: "2026-05-20T12:00:00.000Z",
        release_event_id: "event-release-1",
      },
      {
        session_row_id: "presence-row-1",
        applied: false,
        should_queue: true,
        released_at: "2026-05-20T12:00:00.000Z",
        release_event_id: "event-release-1",
      },
      {
        session_row_id: "presence-row-1",
        applied: true,
        should_queue: true,
        released_at: "2026-05-20T12:02:00.000Z",
        release_event_id: "event-release-2",
      },
    ],
  });
  const { recordSandboxClientRelease } = await loadAutoPauseModule();
  const baseInput = {
    sandboxRecordId,
    sandboxId: "vm_123",
    userId: "user-1",
    tabId: "tab-1",
    sessionId: "session-1",
    releaseReason: "pagehide",
  };

  const firstRelease = await recordSandboxClientRelease(
    {
      ...baseInput,
      eventSeq: 2,
    },
    client
  );
  const duplicateRetry = await recordSandboxClientRelease(
    {
      ...baseInput,
      eventSeq: 2,
    },
    client
  );
  const secondRelease = await recordSandboxClientRelease(
    {
      ...baseInput,
      eventSeq: 4,
    },
    client
  );

  assert.equal(firstRelease.released, true);
  assert.equal(firstRelease.shouldQueue, true);
  assert.equal(firstRelease.releaseEventId, "event-release-1");
  assert.equal(duplicateRetry.released, false);
  assert.equal(duplicateRetry.shouldQueue, true);
  assert.equal(duplicateRetry.releaseEventId, "event-release-1");
  assert.equal(secondRelease.released, true);
  assert.equal(secondRelease.shouldQueue, true);
  assert.equal(secondRelease.releaseEventId, "event-release-2");
  assert.notEqual(firstRelease.releaseEventId, secondRelease.releaseEventId);
  assert.deepEqual(
    state.rpcCalls.map((call) => call.name),
    [
      "record_sandbox_client_release_event",
      "record_sandbox_client_release_event",
      "record_sandbox_client_release_event",
    ]
  );
});

test("recordSandboxClientRelease treats duplicate non-queued releases as no-ops", async () => {
  const { state, client } = createReleaseRpcClient({
    rpcResults: [
      {
        session_row_id: "presence-row-1",
        applied: false,
        should_queue: false,
        released_at: "2026-05-20T12:00:00.000Z",
        release_event_id: "event-release-1",
      },
    ],
  });
  const { recordSandboxClientRelease } = await loadAutoPauseModule();

  const duplicateRelease = await recordSandboxClientRelease(
    {
      sandboxRecordId,
      sandboxId: "vm_123",
      userId: "user-1",
      tabId: "tab-1",
      sessionId: "session-1",
      eventSeq: 2,
      releaseReason: "pagehide",
    },
    client
  );

  assert.deepEqual(duplicateRelease, {
    released: false,
    sessionRowId: "presence-row-1",
    releasedAt: "2026-05-20T12:00:00.000Z",
    releaseEventId: "event-release-1",
    shouldQueue: false,
  });
  assert.deepEqual(
    state.rpcCalls.map((call) => call.name),
    ["record_sandbox_client_release_event"]
  );
});

test("auto-pause records would_auto_pause in observe-only mode", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps();

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "would_auto_pause");
  assert.equal(result.paused, false);
  assert.equal(harness.stopCalls, 0);
  assert.equal(harness.updates.length, 0);
  assert.equal(harness.events.at(-1)?.decisionCode, "would_auto_pause");
});

test("auto-pause pauses a detached persistent sandbox when enabled", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({ mode: "enabled" });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_succeeded");
  assert.equal(result.paused, true);
  assert.deepEqual(harness.claims, [
    {
      sandboxRecordId,
      sandboxId: "vm_123",
      releasedAt,
    },
  ]);
  assert.equal(harness.stopCalls, 1);
  assert.equal(harness.updates.length, 1);
  assert.deepEqual(harness.updates[0].updates, {
    status: "paused",
    health_status: "paused",
    stop_reason: "auto_pause",
    snapshot_id: "snap_123",
  });
  assert.deepEqual(harness.updates[0].options, {
    expectedSandboxId: "vm_123",
    fromStatuses: "pausing",
  });
});

test("auto-pause warns when a persistent sandbox stops without a snapshot id", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({
    mode: "enabled",
    currentSnapshotId: null,
  });
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const result = await runSandboxAutoPauseCheck(
      buildPayload(),
      harness.deps as never
    );

    assert.equal(result.decisionCode, "auto_pause_succeeded");
    assert.equal(result.paused, true);
    assert.equal(harness.updates.length, 1);
    assert.deepEqual(harness.updates[0].updates, {
      status: "paused",
      health_status: "paused",
      stop_reason: "auto_pause",
      snapshot_id: null,
    });
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /without a snapshot ID/);
    assert.deepEqual(warnings[0][1], {
      sandboxRecordId,
      sandboxId: "vm_123",
    });
  } finally {
    console.warn = originalWarn;
  }
});

test("auto-pause skips when another workspace session is still attached", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({ activeSessionCount: 1, mode: "enabled" });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_skipped_new_session");
  assert.equal(harness.stopCalls, 0);
});

test("auto-pause skips old release workers after a reload reattaches", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({ newerSessionEventCount: 1, mode: "enabled" });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_skipped_new_session");
  assert.equal(harness.stopCalls, 0);
});

test("auto-pause skips active exec locks and active AI calls", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();

  const execHarness = buildDeps({
    record: buildRecord({ exec_lock_token: "lock-1" }),
    mode: "enabled",
  });
  const execResult = await runSandboxAutoPauseCheck(
    buildPayload(),
    execHarness.deps as never
  );
  assert.equal(execResult.decisionCode, "auto_pause_skipped_busy");
  assert.equal(execHarness.stopCalls, 0);

  const aiHarness = buildDeps({ activeAiCall: true, mode: "enabled" });
  const aiResult = await runSandboxAutoPauseCheck(
    buildPayload(),
    aiHarness.deps as never
  );
  assert.equal(aiResult.decisionCode, "auto_pause_skipped_busy");
  assert.equal(aiHarness.stopCalls, 0);
});

test("auto-pause skips running automations tied to the sandbox", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({ runningAutomation: true, mode: "enabled" });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_skipped_busy");
  assert.equal(harness.stopCalls, 0);
});

test("auto-pause repeats busy checks immediately before stopping", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({
    activeAiCallSequence: [false, true],
    mode: "enabled",
  });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_skipped_busy");
  assert.equal(harness.stopCalls, 0);
  assert.equal(harness.events.at(-1)?.payload?.phase, "final_check");
});

test("auto-pause restores running state when remote stop fails after claim", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({
    mode: "enabled",
    stopError: new Error("stop failed"),
  });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_failed");
  assert.equal(result.paused, false);
  assert.equal(harness.stopCalls, 1);
  assert.equal(harness.updates.length, 1);
  assert.deepEqual(harness.updates[0].updates, {
    status: "running",
    health_status: "running",
    stop_reason: null,
  });
  assert.deepEqual(harness.updates[0].options, {
    expectedSandboxId: "vm_123",
    fromStatuses: "pausing",
  });
});

test("auto-pause duplicate worker runs no-op when claim fails", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({ mode: "enabled", claimResult: false });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_skipped_status_changed");
  assert.equal(harness.stopCalls, 0);
  assert.equal(harness.events.at(-1)?.payload?.phase, "claim");
});

test("auto-pause skips duplicate workers that observe an in-flight pausing record", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({
    mode: "enabled",
    record: buildRecord({
      status: "pausing",
      health_status: "pausing",
      stop_reason: "auto_pause",
    } as never),
  });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.match(result.decisionCode, /^auto_pause_skipped_/);
  assert.equal(harness.stopCalls, 0);
  assert.equal(harness.claims.length, 0);
  assert.equal(harness.updates.length, 0);
});

test("auto-pause treats lost paused finalization CAS as a no-op without retrying remote stop", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({
    mode: "enabled",
    updateResult: null,
  });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_skipped_status_changed");
  assert.equal(result.paused, false);
  assert.equal(harness.stopCalls, 1);
  assert.equal(harness.updates.length, 1);
  assert.deepEqual(harness.updates[0].updates, {
    status: "paused",
    health_status: "paused",
    stop_reason: "auto_pause",
    snapshot_id: "snap_123",
  });
  assert.deepEqual(harness.updates[0].options, {
    expectedSandboxId: "vm_123",
    fromStatuses: "pausing",
  });
});
