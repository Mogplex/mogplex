import type { isStaleLiveInteractiveCall } from "@/lib/interactive-runs";

type LiveCall = Record<string, unknown>;

/**
 * The live calls still worth showing. A call is hidden only once it has gone
 * without progress for its whole idle window, so calls that are merely old
 * get their newest event read. A call whose events can't be read stays
 * listed, just as the reaper leaves it running.
 */
export async function filterLiveCalls<T extends LiveCall>(
  calls: readonly T[],
  deps: {
    isStaleLiveInteractiveCall: typeof isStaleLiveInteractiveCall;
    loadLatestActivity: (
      callIds: string[]
    ) => Promise<Map<string, string | null | undefined>>;
  }
): Promise<T[]> {
  const agedIds = calls
    .filter((call) => deps.isStaleLiveInteractiveCall(call as never))
    .map((call) => String(call.id));
  const activity =
    agedIds.length > 0
      ? await deps.loadLatestActivity(agedIds)
      : new Map<string, string | null | undefined>();
  return calls.filter((call) => {
    const id = String(call.id);
    if (activity.has(id) && activity.get(id) === undefined) return true;
    return !deps.isStaleLiveInteractiveCall(
      call as never,
      undefined,
      activity.get(id)
    );
  });
}
