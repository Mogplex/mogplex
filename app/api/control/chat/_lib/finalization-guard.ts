/** Serialize Control finalization and only seal the guard after persistence. */
export function createControlFinalizationGuard() {
  let finalized = false;
  let pending: Promise<void> | null = null;

  const persistWithOneRetry = async (finalize: () => Promise<void>) => {
    try {
      await finalize();
    } catch {
      // One immediate persistence retry avoids stranding a sole finalizer.
      // This is bounded work, not a status-polling or sleep-retry loop.
      await finalize();
    }
  };

  const run = async (finalize: () => Promise<void>): Promise<boolean> => {
    if (finalized) return false;
    if (pending) {
      await pending;
      return false;
    }

    const attempt = persistWithOneRetry(finalize);
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

  return {
    isFinalized: () => finalized,
    run,
  };
}
