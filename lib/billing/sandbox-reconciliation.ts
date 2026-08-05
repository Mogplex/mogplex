import {
  accrueSandboxBillingSession,
  finalizeSandboxBillingClose,
  isSandboxBillingBalanceRequiredError,
  isSandboxProviderSessionTerminal,
  prepareSandboxBillingClose,
  readSandboxProviderSession,
  reopenSandboxBillingClose,
  syncSandboxBillingSession,
  type ActiveSandboxBillingSession,
} from "@/lib/billing/sandbox-usage";
import { getBillingBalance } from "@/lib/billing/ledger";
import { getPlatformSandboxCredentials } from "@/lib/sandbox/get-user-credentials";
import { stopSandboxRecord } from "@/lib/sandbox/records";
import { getSandboxIfExists } from "@/lib/sandbox/sdk-adapter";
import { supabaseAdmin } from "@/lib/supabase/admin";

type SandboxBillingRecord = {
  id: string;
  sandbox_id: string;
  billing_source: string | null;
  actor_user_id: string | null;
  user_id: string;
  product_team_id: string | null;
  status: string;
};

export const SANDBOX_BILLING_CLOSE_GRACE_MS = 2 * 60 * 1_000;
export const SANDBOX_BILLING_ACTIVE_SESSION_BATCH_SIZE = 100;
export const SANDBOX_BILLING_RECOVERY_BATCH_SIZE = 250;

export type SandboxBillingReconciliationSummary = {
  processed: number;
  accrued: number;
  finalized: number;
  rotated: number;
  opened: number;
  depleted: number;
  skipped: number;
  failed: number;
  errors: { sessionId: string; message: string }[];
  message: string;
};

type SandboxBillingReconciliationDeps = {
  loadActiveSessions: typeof loadActiveSandboxBillingSessions;
  loadRecords: typeof loadSandboxBillingRecords;
  loadActivePlatformRecords: typeof loadActivePlatformSandboxBillingRecords;
  getCredentials: typeof getPlatformSandboxCredentials;
  getSandbox: typeof getSandboxIfExists;
  accrue: typeof accrueSandboxBillingSession;
  prepareClose: typeof prepareSandboxBillingClose;
  finalizeClose: typeof finalizeSandboxBillingClose;
  reopenClose: typeof reopenSandboxBillingClose;
  syncSession: typeof syncSandboxBillingSession;
  getBalance: typeof getBillingBalance;
  stopRecord: typeof stopSandboxRecord;
  now: () => Date;
};

const defaultDeps: SandboxBillingReconciliationDeps = {
  loadActiveSessions: loadActiveSandboxBillingSessions,
  loadRecords: loadSandboxBillingRecords,
  loadActivePlatformRecords: loadActivePlatformSandboxBillingRecords,
  getCredentials: getPlatformSandboxCredentials,
  getSandbox: getSandboxIfExists,
  accrue: accrueSandboxBillingSession,
  prepareClose: prepareSandboxBillingClose,
  finalizeClose: finalizeSandboxBillingClose,
  reopenClose: reopenSandboxBillingClose,
  syncSession: syncSandboxBillingSession,
  getBalance: getBillingBalance,
  stopRecord: stopSandboxRecord,
  now: () => new Date(),
};

export async function loadActiveSandboxBillingSessions(): Promise<
  ActiveSandboxBillingSession[]
> {
  const { data, error } = await supabaseAdmin
    .from("sandbox_billing_sessions")
    .select(
      "id, sandbox_record_id, vercel_sandbox_id, vercel_session_id, account_id, actor_user_id, product_team_id, state, started_at, metered_through_at, close_generation, close_requested_at"
    )
    .in("state", ["open", "closing"])
    .order("metered_through_at", { ascending: true })
    .limit(SANDBOX_BILLING_ACTIVE_SESSION_BATCH_SIZE);
  if (error) {
    throw new Error(
      `active sandbox billing session load failed: ${error.message}`
    );
  }
  return (data ?? []) as ActiveSandboxBillingSession[];
}

export async function loadSandboxBillingRecords(
  recordIds: string[]
): Promise<SandboxBillingRecord[]> {
  if (recordIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .select(
      "id, sandbox_id, billing_source, actor_user_id, user_id, product_team_id, status"
    )
    .in("id", recordIds);
  if (error) {
    throw new Error(`sandbox billing record load failed: ${error.message}`);
  }
  return (data ?? []) as SandboxBillingRecord[];
}

export async function loadActivePlatformSandboxBillingRecords(): Promise<
  SandboxBillingRecord[]
> {
  const { data, error } = await supabaseAdmin.rpc(
    "list_unmetered_platform_sandboxes",
    { p_limit: SANDBOX_BILLING_RECOVERY_BATCH_SIZE }
  );
  if (error) {
    throw new Error(
      `unmetered platform sandbox recovery load failed: ${error.message}`
    );
  }
  return (data ?? []) as SandboxBillingRecord[];
}

function closeAttemptForSession(session: ActiveSandboxBillingSession) {
  return {
    sessionId: session.id,
    closeGeneration: session.close_generation,
    actorUserId: session.actor_user_id,
  };
}

function safeProviderEnd(
  provider: ReturnType<typeof readSandboxProviderSession>,
  fallback: Date
) {
  return provider.stoppedAt ?? provider.updatedAt ?? fallback;
}

async function markDepletedRecord(
  record: SandboxBillingRecord,
  deps: Pick<SandboxBillingReconciliationDeps, "stopRecord">
) {
  await deps.stopRecord(record.id, {
    expectedSandboxId: record.sandbox_id,
    stopReason: "billing_depleted",
  });
}

async function stopSandboxWithConfirmation(input: {
  record: SandboxBillingRecord;
  sandbox: NonNullable<Awaited<ReturnType<typeof getSandboxIfExists>>>;
  credentials: ReturnType<typeof getPlatformSandboxCredentials>;
  deps: Pick<SandboxBillingReconciliationDeps, "getSandbox">;
}) {
  let stopError: unknown;
  try {
    await input.sandbox.stop({ blocking: true });
    return;
  } catch (error) {
    stopError = error;
  }

  const observed = await input.deps.getSandbox(input.record.sandbox_id, {
    vercelToken: input.credentials.vercelToken!,
    vercelTeamId: input.credentials.vercelTeamId,
    vercelProjectId: input.credentials.vercelProjectId!,
  });
  if (
    !observed ||
    isSandboxProviderSessionTerminal(readSandboxProviderSession(observed))
  ) {
    return;
  }
  throw stopError instanceof Error
    ? stopError
    : new Error("sandbox stop was not confirmed by provider");
}

async function stopDepletedSandbox(input: {
  session: ActiveSandboxBillingSession;
  record: SandboxBillingRecord;
  sandbox: NonNullable<Awaited<ReturnType<typeof getSandboxIfExists>>>;
  credentials: ReturnType<typeof getPlatformSandboxCredentials>;
  deps: SandboxBillingReconciliationDeps;
}) {
  const requestedAt = input.deps.now();
  const attempt = await input.deps.prepareClose(
    input.session.sandbox_record_id,
    requestedAt
  );
  let stopError: unknown = null;
  try {
    await input.sandbox.stop({ blocking: true });
  } catch (error) {
    stopError = error;
  }

  // A failed stop response is ambiguous. Re-read provider state once; only a
  // confirmed still-running copy may reopen this close generation.
  const observed = await input.deps.getSandbox(input.record.sandbox_id, {
    vercelToken: input.credentials.vercelToken!,
    vercelTeamId: input.credentials.vercelTeamId,
    vercelProjectId: input.credentials.vercelProjectId!,
  });
  if (!observed) {
    await input.deps.finalizeClose(
      attempt,
      attempt?.meteredThroughAt ?? new Date(input.session.metered_through_at)
    );
    await markDepletedRecord(input.record, input.deps);
    return;
  }

  const provider = readSandboxProviderSession(observed);
  if (isSandboxProviderSessionTerminal(provider)) {
    await input.deps.finalizeClose(
      attempt,
      safeProviderEnd(provider, requestedAt)
    );
    await markDepletedRecord(input.record, input.deps);
    return;
  }
  if (provider.sessionId === input.session.vercel_session_id) {
    if (stopError) {
      await input.deps.reopenClose(attempt);
    }
    throw stopError instanceof Error
      ? stopError
      : new Error("sandbox stop was not confirmed by provider");
  }

  // The provider rotated despite the stop attempt. Close the paid predecessor
  // at the replacement boundary, then stop the unfunded replacement too.
  await input.deps.finalizeClose(attempt, provider.startedAt);
  await stopSandboxWithConfirmation({
    record: input.record,
    sandbox: observed,
    credentials: input.credentials,
    deps: input.deps,
  });
  await markDepletedRecord(input.record, input.deps);
}

async function reconcileActiveSession(input: {
  session: ActiveSandboxBillingSession;
  record: SandboxBillingRecord | null;
  credentials: ReturnType<typeof getPlatformSandboxCredentials>;
  deps: SandboxBillingReconciliationDeps;
}): Promise<"accrued" | "finalized" | "rotated" | "depleted" | "skipped"> {
  const { session, record, credentials, deps } = input;
  if (!record) {
    const attempt = await deps.prepareClose(
      session.sandbox_record_id,
      new Date(session.metered_through_at)
    );
    await deps.finalizeClose(attempt, new Date(session.metered_through_at));
    return "finalized";
  }
  if (!credentials.vercelToken || !credentials.vercelProjectId) {
    return "skipped";
  }

  const sandbox = await deps.getSandbox(record.sandbox_id, {
    vercelToken: credentials.vercelToken,
    vercelTeamId: credentials.vercelTeamId,
    vercelProjectId: credentials.vercelProjectId,
  });
  if (!sandbox) {
    const through = new Date(session.metered_through_at);
    const attempt = await deps.prepareClose(session.sandbox_record_id, through);
    await deps.finalizeClose(attempt, through);
    return "finalized";
  }

  const provider = readSandboxProviderSession(sandbox);
  if (provider.sessionId !== session.vercel_session_id) {
    const attempt = await deps.prepareClose(
      session.sandbox_record_id,
      provider.startedAt
    );
    await deps.finalizeClose(attempt, provider.startedAt);
    if (isSandboxProviderSessionTerminal(provider)) return "rotated";
    let synced;
    try {
      synced = await deps.syncSession({ record, sandbox });
    } catch (error) {
      await stopSandboxWithConfirmation({
        record,
        sandbox,
        credentials,
        deps,
      });
      const depleted = isSandboxBillingBalanceRequiredError(error);
      await deps.stopRecord(record.id, {
        expectedSandboxId: record.sandbox_id,
        stopReason: depleted ? "billing_depleted" : "unknown",
      });
      if (depleted) return "depleted";
      throw error;
    }
    if (synced.reason === "no_billing_account") {
      await stopSandboxWithConfirmation({
        record,
        sandbox,
        credentials,
        deps,
      });
      await markDepletedRecord(record, deps);
      return "depleted";
    }
    return "rotated";
  }

  if (isSandboxProviderSessionTerminal(provider)) {
    const endedAt = safeProviderEnd(
      provider,
      new Date(session.metered_through_at)
    );
    const attempt = await deps.prepareClose(session.sandbox_record_id, endedAt);
    await deps.finalizeClose(attempt, endedAt);
    return "finalized";
  }

  if (session.state === "closing") {
    const requestedAt = session.close_requested_at
      ? Date.parse(session.close_requested_at)
      : Number.NaN;
    const closeIsFresh =
      Number.isFinite(requestedAt) &&
      deps.now().getTime() - requestedAt < SANDBOX_BILLING_CLOSE_GRACE_MS;
    if (closeIsFresh) return "skipped";
    const recordExpectsRunning = ["creating", "installing", "running"].includes(
      record.status
    );
    if (!recordExpectsRunning) {
      await sandbox.stop({ blocking: true });
      const observed = await deps.getSandbox(record.sandbox_id, {
        vercelToken: credentials.vercelToken,
        vercelTeamId: credentials.vercelTeamId,
        vercelProjectId: credentials.vercelProjectId,
      });
      if (
        observed &&
        !isSandboxProviderSessionTerminal(readSandboxProviderSession(observed))
      ) {
        throw new Error("sandbox stop was not confirmed by provider");
      }
      const endedAt = observed
        ? safeProviderEnd(readSandboxProviderSession(observed), deps.now())
        : new Date(session.metered_through_at);
      await deps.finalizeClose(closeAttemptForSession(session), endedAt);
      return "finalized";
    }
    await deps.reopenClose(closeAttemptForSession(session));
  }
  await deps.accrue(session.id, deps.now());
  const balance = await deps.getBalance(session.account_id);
  if (balance.totalCents > 0) return "accrued";
  await stopDepletedSandbox({ session, record, sandbox, credentials, deps });
  return "depleted";
}

function buildSummary(
  counts: Omit<SandboxBillingReconciliationSummary, "message">
): SandboxBillingReconciliationSummary {
  return {
    ...counts,
    message: `Reconciled ${counts.processed} sandbox billing sessions: ${counts.opened} opened, ${counts.accrued} accrued, ${counts.finalized} finalized, ${counts.rotated} rotated, ${counts.depleted} depleted, ${counts.skipped} skipped, ${counts.failed} failed.`,
  };
}

export async function reconcileSandboxBillingSessions(
  overrides: Partial<SandboxBillingReconciliationDeps> = {}
): Promise<SandboxBillingReconciliationSummary> {
  const deps = { ...defaultDeps, ...overrides };
  const sessions = await deps.loadActiveSessions();
  const [records, activePlatformRecords] = await Promise.all([
    deps.loadRecords(sessions.map((session) => session.sandbox_record_id)),
    deps.loadActivePlatformRecords(),
  ]);
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const credentials = deps.getCredentials();
  const counts = {
    processed: sessions.length,
    accrued: 0,
    finalized: 0,
    rotated: 0,
    opened: 0,
    depleted: 0,
    skipped: 0,
    failed: 0,
    errors: [] as { sessionId: string; message: string }[],
  };

  const initiallyMeteredRecordIds = new Set(
    sessions.map((session) => session.sandbox_record_id)
  );
  // Recovery gets a separately bounded batch and runs first. A large metered
  // population can therefore never consume the whole Trigger duration before
  // crash-gap provider sessions have a chance to be admitted or stopped.
  for (const record of activePlatformRecords) {
    if (initiallyMeteredRecordIds.has(record.id)) continue;
    counts.processed += 1;
    if (!credentials.vercelToken || !credentials.vercelProjectId) {
      counts.skipped += 1;
      continue;
    }
    try {
      const sandbox = await deps.getSandbox(record.sandbox_id, {
        vercelToken: credentials.vercelToken,
        vercelTeamId: credentials.vercelTeamId,
        vercelProjectId: credentials.vercelProjectId,
      });
      if (!sandbox) {
        counts.skipped += 1;
        continue;
      }
      const provider = readSandboxProviderSession(sandbox);
      if (isSandboxProviderSessionTerminal(provider)) {
        counts.skipped += 1;
        continue;
      }
      let synced;
      try {
        synced = await deps.syncSession({ record, sandbox });
      } catch (error) {
        await stopSandboxWithConfirmation({
          record,
          sandbox,
          credentials,
          deps,
        });
        const depleted = isSandboxBillingBalanceRequiredError(error);
        await deps.stopRecord(record.id, {
          expectedSandboxId: record.sandbox_id,
          stopReason: depleted ? "billing_depleted" : "unknown",
        });
        if (depleted) {
          counts.depleted += 1;
          continue;
        }
        throw error;
      }
      if (synced.reason === "no_billing_account") {
        await stopSandboxWithConfirmation({
          record,
          sandbox,
          credentials,
          deps,
        });
        await markDepletedRecord(record, deps);
        counts.depleted += 1;
      } else {
        counts[synced.metered ? "opened" : "skipped"] += 1;
      }
    } catch (error) {
      counts.failed += 1;
      counts.errors.push({
        sessionId: `record:${record.id}`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Provider calls remain sequential to avoid an API burst. The database
  // batch is ordered by oldest meter timestamp, and successful accrual moves a
  // row to the back of the next run's queue.
  for (const session of sessions) {
    try {
      const outcome = await reconcileActiveSession({
        session,
        record: recordsById.get(session.sandbox_record_id) ?? null,
        credentials,
        deps,
      });
      counts[outcome] += 1;
    } catch (error) {
      counts.failed += 1;
      counts.errors.push({
        sessionId: session.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return buildSummary(counts);
}
