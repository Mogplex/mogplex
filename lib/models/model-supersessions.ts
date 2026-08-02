// Deprecated-model bookkeeping: the counterpart to new-model auto-enable.
//
// When the catalog sync retires a model because a newer same-priced version of
// the same family exists (see anthropic-version-policy.ts), every saved
// reference to the retired id — automation node model overrides, agent base
// models, user default models — would otherwise keep pointing at a model the
// stale sweep marks unavailable. `model_supersessions` records the
// deprecated -> successor mapping so those references can be upgraded.
//
// Invariant: stored rows are *terminal* — a deprecated id always points
// directly at a model that is not itself deprecated. `planSupersessionWrites`
// maintains that when a newer version arrives (Opus 4.7 -> 4.8 becomes
// 4.7 -> 5 once Opus 5 supersedes 4.8), so both the SQL reconciler and the
// runtime resolver stay single-hop lookups.

export type ModelSupersessionRow = {
  deprecated_model_id: string;
  successor_model_id: string;
};

export type DiscoveredSupersession = {
  deprecatedId: string;
  successorId: string;
};

// Follow the chain to the id nothing supersedes. Returns null when the input
// is not deprecated, or when the chain cycles — a cycle is unresolvable, so
// callers treat it as "no upgrade" rather than picking an arbitrary member.
function resolveTerminalId(
  startId: string,
  edges: ReadonlyMap<string, string>
): string | null {
  const seen = new Set<string>([startId]);
  let current = edges.get(startId);
  if (current === undefined) return null;

  while (true) {
    if (seen.has(current)) return null;
    seen.add(current);
    const next = edges.get(current);
    if (next === undefined) return current;
    current = next;
  }
}

/**
 * Collapse stored rows into a single-hop lookup map. Stored rows are already
 * terminal, so this is normally a straight copy — the chain walk is a cheap
 * guard for rows written before a later supersession collapsed them (or by an
 * older deploy), and it drops self-references and cycles rather than
 * propagating an unusable upgrade.
 */
export function buildSupersessionMap(
  rows: ReadonlyArray<ModelSupersessionRow>,
  // Collects ids dropped as unresolvable. A cycle (A -> B -> A) means the table
  // has been corrupted — the CHECK constraint only blocks self-reference — and
  // the symptom would otherwise be "pins mysteriously stop upgrading" with
  // nothing in the logs. Callers pass this in to report it.
  dropped?: string[]
): Map<string, string> {
  const edges = new Map<string, string>();
  for (const row of rows) {
    if (!row.deprecated_model_id || !row.successor_model_id) continue;
    if (row.deprecated_model_id === row.successor_model_id) {
      dropped?.push(row.deprecated_model_id);
      continue;
    }
    edges.set(row.deprecated_model_id, row.successor_model_id);
  }

  const resolved = new Map<string, string>();
  for (const deprecatedId of edges.keys()) {
    const terminal = resolveTerminalId(deprecatedId, edges);
    if (terminal) {
      resolved.set(deprecatedId, terminal);
      continue;
    }
    dropped?.push(deprecatedId);
  }
  return resolved;
}

/** The model a saved reference should use now. Unknown ids pass through. */
export function resolveUpgradedModelId(
  modelId: string,
  supersessions: ReadonlyMap<string, string>
): string {
  return supersessions.get(modelId) ?? modelId;
}

/**
 * Rows to upsert so the table stays terminal after this sync.
 *
 * Emits an entry only when it is new or when its terminal successor moved,
 * keeping the write a no-op on the steady-state sync (the common case: the
 * catalog is unchanged and every supersession is already recorded).
 */
export function planSupersessionWrites(
  input: {
    existing: ReadonlyArray<ModelSupersessionRow>;
    discovered: ReadonlyArray<DiscoveredSupersession>;
  },
  // Same collector as buildSupersessionMap. This is the half that would write
  // corruption forward, so it must not be the quieter of the two.
  dropped?: string[]
): ModelSupersessionRow[] {
  const edges = new Map<string, string>();
  for (const row of input.existing) {
    if (row.deprecated_model_id === row.successor_model_id) continue;
    edges.set(row.deprecated_model_id, row.successor_model_id);
  }
  // Discovered wins: this sync observed the current catalog, so its successor
  // is newer information than whatever an earlier sync recorded.
  for (const found of input.discovered) {
    if (found.deprecatedId === found.successorId) continue;
    edges.set(found.deprecatedId, found.successorId);
  }

  const storedById = new Map(
    input.existing.map((row) => [
      row.deprecated_model_id,
      row.successor_model_id,
    ])
  );

  const writes: ModelSupersessionRow[] = [];
  for (const deprecatedId of edges.keys()) {
    const terminal = resolveTerminalId(deprecatedId, edges);
    if (!terminal) {
      dropped?.push(deprecatedId);
      continue;
    }
    if (storedById.get(deprecatedId) === terminal) continue;
    writes.push({
      deprecated_model_id: deprecatedId,
      successor_model_id: terminal,
    });
  }
  return writes;
}

// Flow draft graphs are rewritten by upgrade_deprecated_model_pins() in SQL
// (20260725120000_model_supersessions.sql) rather than here: the rewrite has to
// be atomic across flows/agents/profiles and set-based over JSONB, and doing it
// in Postgres avoids reading every graph into the cron process. Behaviour of
// that rewrite is covered by tests/db/model-supersessions.test.ts.
