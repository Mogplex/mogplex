/** Serialize Control finalization and only seal the guard after persistence. */
export function createControlFinalizationGuard() {
  let finalized = false;
  let pending: Promise<void> | null = null;

  const run = async (finalize: () => Promise<void>): Promise<boolean> => {
    if (finalized) return false;
    if (pending) {
      try {
        await pending;
        return false;
      } catch {
        // The failed attempt clears `pending` before rejecting. A concurrent
        // lifecycle path may now retry its own finalization operation.
        return run(finalize);
      }
    }

    const attempt = Promise.resolve().then(finalize);
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
