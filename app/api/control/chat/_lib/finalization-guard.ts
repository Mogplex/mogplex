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

  const run = async (
    persistIdempotently: () => Promise<void>
  ): Promise<boolean> => {
    if (finalized) return false;
    if (pending) {
      try {
        await pending;
        return false;
      } catch {
        // A lifecycle path that joined two failed persistence attempts gets
        // one serialized chance to persist its own terminal state.
        if (finalized) return false;
        if (pending) {
          await pending;
          return false;
        }
        return startAttempt(persistIdempotently);
      }
    }

    return startAttempt(persistIdempotently);
  };

  return {
    isFinalized: () => finalized,
    run,
  };
}
