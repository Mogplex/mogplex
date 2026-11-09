/**
 * Serialize Control finalization and only seal the guard after persistence.
 * The callback must be safe to repeat after a partial failure. Control callers
 * meet that contract: claim release is idempotent, completion overwrites the
 * same call record, and the best-effort terminal event append never rejects.
 */
export function createControlFinalizationGuard() {
  let finalized = false;
  let pending: Promise<void> | null = null;

  const persistWithOneRetry = async (
    persistIdempotently: () => Promise<void>
  ) => {
    try {
      await persistIdempotently();
    } catch {
      // One immediate persistence retry avoids stranding a sole finalizer.
      // This is bounded work, not a status-polling or sleep-retry loop.
      await persistIdempotently();
    }
  };

  const startAttempt = async (
    persistIdempotently: () => Promise<void>
  ): Promise<boolean> => {
    const attempt = persistWithOneRetry(persistIdempotently);
    const tracked = attempt
      .then(() => {
        finalized = true;
      })
      .finally(() => {
        if (pending === tracked) pending = null;
      });
    pending = tracked;
    await tracked;
    return true;
  };

  const joinPendingOrStart = async (
    persistIdempotently: () => Promise<void>
  ): Promise<boolean> => {
    const activeAttempt = pending;
    if (!activeAttempt) return startAttempt(persistIdempotently);
    try {
      await activeAttempt;
      return false;
    } catch {
      // Re-evaluate after an event-driven attempt settles. If another caller
      // already started a replacement, join it; otherwise persist this state.
      if (finalized) return false;
      return joinPendingOrStart(persistIdempotently);
    }
  };

  const run = async (
    persistIdempotently: () => Promise<void>
  ): Promise<boolean> => {
    if (finalized) return false;
    return joinPendingOrStart(persistIdempotently);
  };

  return {
    isFinalized: () => finalized,
    run,
  };
}
