import {
  planSupersessionWrites,
  type DiscoveredSupersession,
  type ModelSupersessionRow,
} from "@/lib/models/model-supersessions";
import type { SyncModelsDeps, SupersessionReconcileResult } from "./types";

/**
 * Surface mappings that exist but are not in effect.
 *
 * A supersession drops out of model_supersessions_effective when its successor
 * is not currently offered — including the case where the successor briefly left
 * the gateway catalog, got swept to is_hidden = true, and came back: the sync
 * deliberately omits is_hidden from its upsert so hides are durable, so the
 * successor stays hidden and every mapping pointing at it goes quiet.
 *
 * That fails in the safe direction but is otherwise invisible, since an
 * unresolved id looks exactly like a model that was never superseded. Same
 * reasoning as the dropped-cycle logging in buildSupersessionMap: turn "pins
 * mysteriously stopped upgrading" into a line in the cron log.
 *
 * `table` must be the post-write table, not the snapshot read at the top of the
 * reconcile: rows written by this run are the ones most worth checking, and
 * passing the pre-write snapshot silently excluded every one of them.
 *
 * Who guarantees that: reconcileSupersessions builds it in memory as
 * `existing − retractedIds − purgedIds + writes`. It is NOT re-read from the
 * database — one fewer round-trip on the hot path of a cron that mostly has
 * nothing to do, and the three deltas are exactly what this function ran. Both
 * id sets are populated only after their DELETE returned without error, so a
 * failed purge correctly leaves those rows both in the table and eligible to be
 * reported here. Pinned by "does not report a retraction as inert".
 */
async function warnOnInertSupersessions(
  deps: SyncModelsDeps,
  table: ModelSupersessionRow[]
) {
  if (table.length === 0) return;

  const { data: effective, error } =
    await deps.listEffectiveModelSupersessions();
  if (error || !effective) {
    console.warn("[sync-models] could not check effective supersessions", {
      message: error?.message,
    });
    return;
  }

  const inEffect = new Set(effective);
  const inert = table
    .map((row) => row.deprecated_model_id)
    .filter((id) => !inEffect.has(id));

  if (inert.length > 0) {
    console.warn("[sync-models] supersessions recorded but not in effect", {
      deprecatedModelIds: inert,
      reason: "successor is not currently offered (is_available / is_hidden)",
    });
  }
}

// Every exit path returns the same keys, so nothing reading the JSON has to
// branch on which fields exist.
//
// A uniform shape alone would make a healthy no-op and an aborted run
// byte-identical — both are all-zeros with a null pins_upgraded, and the
// failure would live only in the cron log. `reconcile_status` is what actually
// tells them apart; the uniformity just keeps the shape stable.
export function supersessionReconcileResult(
  overrides: Partial<SupersessionReconcileResult> = {}
): SupersessionReconcileResult {
  return {
    reconcile_status: "ok",
    supersessions_recorded: 0,
    supersessions_purged: 0,
    pins_upgraded: null,
    ...overrides,
  };
}

type RetractResult =
  | { success: true; retractedIds: Set<string> }
  | { success: false };

/**
 * Retract mappings the policy no longer agrees with. If this sync *retained*
 * a model, it is not superseded any more (e.g. its successor's pricing
 * diverged), so a stored mapping for it is stale and would keep moving pins
 * off a model that is on offer again.
 */
async function retractStaleSupersessions(
  deps: SyncModelsDeps,
  existing: ModelSupersessionRow[],
  retainedModelIds: string[]
): Promise<RetractResult> {
  const retained = new Set(retainedModelIds);
  const retracted = existing
    .map((row) => row.deprecated_model_id)
    .filter((id) => retained.has(id));

  if (retracted.length === 0) {
    return { success: true, retractedIds: new Set() };
  }

  const deleted = await deps.deleteModelSupersessions(retracted);
  if (deleted.error) {
    // Bail before touching any pins. The stale row is still in the table and
    // the view's deprecated-side guard cannot catch it (a re-offered model
    // keeps is_hidden = true), so continuing would rewrite pins *off* a model
    // the policy just re-retained — and unlike the mapping table, that
    // rewrite does not heal on the next run: the pin has already moved.
    console.warn("[sync-models] failed to retract supersessions", {
      message: deleted.error.message,
      deprecatedModelIds: retracted,
    });
    return { success: false };
  }

  console.log("[sync-models] retracted supersessions", {
    deprecatedModelIds: retracted,
  });
  return { success: true, retractedIds: new Set(retracted) };
}

/**
 * Purge unresolvable supersession chains (cycles).
 * Returns the set of purged IDs (empty if purge failed or nothing to purge).
 */
async function purgeUnresolvableChains(
  deps: SyncModelsDeps,
  unresolvable: string[]
): Promise<ReadonlySet<string>> {
  if (unresolvable.length === 0) {
    return new Set();
  }

  // Only reachable if model_supersessions has been corrupted into a cycle
  // (the CHECK constraint blocks the single-hop case, so this needs two bad
  // writes). Repair it rather than only logging: left in place, the affected
  // pins would stop upgrading permanently and the error line would repeat on
  // every cache refresh forever. Deleting is recoverable — the policy
  // re-derives the correct mapping from the catalog on a later sync.
  console.error("[sync-models] deleting unresolvable supersession chains", {
    deprecatedModelIds: unresolvable,
  });

  const purged = await deps.deleteModelSupersessions(unresolvable);
  if (purged.error) {
    console.warn("[sync-models] failed to delete unresolvable chains", {
      message: purged.error.message,
    });
    return new Set();
  }

  return new Set(unresolvable);
}

/**
 * Build the post-write table state for the inert check.
 */
function buildPostWriteTable(
  existing: ModelSupersessionRow[],
  retractedIds: ReadonlySet<string>,
  purgedIds: ReadonlySet<string>,
  writes: ModelSupersessionRow[]
): ModelSupersessionRow[] {
  return [
    ...existing.filter(
      (row) =>
        !retractedIds.has(row.deprecated_model_id) &&
        !purgedIds.has(row.deprecated_model_id)
    ),
    ...writes,
  ];
}

export async function reconcileSupersessions(
  deps: SyncModelsDeps,
  discovered: DiscoveredSupersession[],
  retainedModelIds: string[]
): Promise<SupersessionReconcileResult> {
  const { data: existing, error: existingError } =
    await deps.listModelSupersessions();
  if (existingError) {
    console.warn("[sync-models] failed to load supersessions", {
      message: existingError.message,
    });
    return supersessionReconcileResult({ reconcile_status: "aborted" });
  }

  const existingRows = existing ?? [];
  const retractResult = await retractStaleSupersessions(
    deps,
    existingRows,
    retainedModelIds
  );
  if (!retractResult.success) {
    return supersessionReconcileResult({ reconcile_status: "aborted" });
  }

  const { retractedIds } = retractResult;
  const unresolvable: string[] = [];
  const writes = planSupersessionWrites(
    {
      existing: existingRows.filter(
        (row) => !retractedIds.has(row.deprecated_model_id)
      ),
      discovered,
    },
    unresolvable
  );

  const purgedIds = await purgeUnresolvableChains(deps, unresolvable);

  // Skipped entirely on the steady-state sync, where the catalog is unchanged
  // and every supersession is already recorded.
  if (writes.length > 0) {
    const recorded = await deps.recordModelSupersessions(writes);
    if (recorded.error) {
      console.warn("[sync-models] failed to record supersessions", {
        message: recorded.error.message,
      });
      return supersessionReconcileResult({
        reconcile_status: "aborted",
        supersessions_purged: purgedIds.size,
      });
    }
  }

  // INVARIANT: what goes in is the table as it now stands, not the snapshot
  // this run started from. Retracted and purged ids must be subtracted (they
  // were deleted on purpose, so warning about them is a false positive — this
  // is what the dropped `retractedIds` parameter used to guard), and `writes`
  // must be added (rows recorded by this run are the ones most worth checking,
  // and omitting them was the bug). Nothing in the signature enforces this;
  // "retraction is not reported as inert" covers it in sync-models-route.test.
  const postWriteTable = buildPostWriteTable(
    existingRows,
    retractedIds,
    purgedIds,
    writes
  );
  await warnOnInertSupersessions(deps, postWriteTable);

  // Reconcile on every run, not just when `writes` is non-empty: a user who
  // re-enabled auto-adopt, or a flow created while a model was already
  // deprecated, still needs its pins moved forward.
  const upgraded = await deps.upgradeDeprecatedModelPins();
  if (upgraded.error) {
    console.warn("[sync-models] failed to upgrade deprecated pins", {
      message: upgraded.error.message,
    });
    return supersessionReconcileResult({
      reconcile_status: "aborted",
      supersessions_recorded: writes.length,
      supersessions_purged: purgedIds.size,
    });
  }

  if (
    upgraded.data &&
    Object.values(upgraded.data).some((count) => count > 0)
  ) {
    console.log("[sync-models] upgraded deprecated model pins", upgraded.data);
  }

  return supersessionReconcileResult({
    supersessions_recorded: writes.length,
    // The count of rows actually removed, so a failed purge does not report
    // repair work that did not happen.
    supersessions_purged: purgedIds.size,
    pins_upgraded: upgraded.data,
  });
}
