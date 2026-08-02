import { after, NextResponse } from "next/server";
import { requireMachineApiAuth } from "@/lib/internal-api-auth";
import { resolveAnthropicNewestVersionPolicy } from "@/lib/models/anthropic-version-policy";
import { normalizeCatalogModelName } from "@/lib/models/catalog-normalization";
import {
  planSupersessionWrites,
  type DiscoveredSupersession,
  type ModelSupersessionRow,
} from "@/lib/models/model-supersessions";
import {
  syncProviderIcons,
  type ProviderIconSyncResult,
} from "@/lib/models/provider-icon-sync";
import { normalizeProviderIconProviders } from "@/lib/models/provider-icon";
import { computeModelRecommendations } from "@/lib/models/recommendations";
import { supabaseAdmin } from "@/lib/supabase/admin";

type GatewayModel = {
  id: string;
  name: string;
  owned_by: string;
  type: string;
  context_window?: number;
  max_tokens?: number;
  tags?: string[];
  released?: number;
  // Vercel's catalog exposes cache pricing under different keys depending on
  // provider. Anthropic models commonly use cache_input / cache_creation; some
  // entries use the cache_read / cache_write shorthand instead. Newer rows can
  // expose input_cache_read / input_cache_write. Accept all known variants.
  pricing?: {
    input?: string;
    output?: string;
    cache_input?: string;
    cache_creation?: string;
    cache_read?: string;
    cache_write?: string;
    input_cache_read?: string;
    input_cache_write?: string;
    input_cache_creation?: string;
  };
};

type SyncModelsDeps = {
  requireMachineApiAuth: (
    request: Request,
    pathname: string
  ) => Response | null | undefined;
  fetchGatewayModels: () => Promise<GatewayModel[]>;
  syncProviderIcons: (providers: string[]) => Promise<ProviderIconSyncResult>;
  scheduleAfterResponse: (work: () => void | Promise<void>) => void;
  listExistingModelIds: () => Promise<{
    data: string[] | null;
    error: { message: string } | null;
  }>;
  markModelsUnavailable: (
    modelIds: string[]
  ) => Promise<{ error: { message: string } | null }>;
  listModelSupersessions: () => Promise<{
    data: ModelSupersessionRow[] | null;
    error: { message: string } | null;
  }>;
  recordModelSupersessions: (
    rows: ModelSupersessionRow[]
  ) => Promise<{ error: { message: string } | null }>;
  // Removes mappings for models the policy no longer considers superseded.
  deleteModelSupersessions: (
    deprecatedModelIds: string[]
  ) => Promise<{ error: { message: string } | null }>;
  // The subset of mappings currently in effect, i.e. what both consumers see.
  listEffectiveModelSupersessions: () => Promise<{
    data: string[] | null;
    error: { message: string } | null;
  }>;
  // Repoints saved references (draft graphs, agent base models, default
  // models) at the recorded successors. Returns per-table counts for logging.
  upgradeDeprecatedModelPins: () => Promise<{
    data: Record<string, number> | null;
    error: { message: string } | null;
  }>;
  upsertModelsBatch: (
    batch: Array<{
      id: string;
      provider: string;
      name: string;
      context_length: number | null;
      capabilities: string[];
      pricing_input: number | null;
      pricing_output: number | null;
      pricing_cache_read: number | null;
      pricing_cache_write: number | null;
      is_available: boolean;
      is_recommended: boolean;
      recommendation_bucket: "open" | "frontier" | null;
      recommendation_rank: number | null;
      recommendation_reason: string | null;
      recommended_at: string | null;
      updated_at: string;
    }>
  ) => Promise<{ error: { message: string } | null }>;
};

const defaultSyncModelsDeps: SyncModelsDeps = {
  requireMachineApiAuth,
  syncProviderIcons,
  scheduleAfterResponse: (work) => {
    after(work);
  },
  async fetchGatewayModels() {
    const res = await fetch("https://ai-gateway.vercel.sh/v1/models");
    if (!res.ok) {
      throw new Error("Failed to fetch AI Gateway models");
    }
    const { data: models } = (await res.json()) as { data: GatewayModel[] };
    return models;
  },
  async listExistingModelIds() {
    const { data, error } = await supabaseAdmin.from("ai_models").select("id");

    return {
      data: data?.map((row) => row.id) ?? null,
      error: error ? { message: error.message } : null,
    };
  },
  async markModelsUnavailable(modelIds) {
    if (modelIds.length === 0) {
      return { error: null };
    }

    const { error } = await supabaseAdmin
      .from("ai_models")
      .update(buildStaleGatewayModelUpdate())
      .in("id", modelIds);

    return {
      error: error ? { message: error.message } : null,
    };
  },
  async listModelSupersessions() {
    const { data, error } = await supabaseAdmin
      .from("model_supersessions")
      .select("deprecated_model_id, successor_model_id");

    return {
      data: (data ?? null) as ModelSupersessionRow[] | null,
      error: error ? { message: error.message } : null,
    };
  },
  async recordModelSupersessions(rows) {
    if (rows.length === 0) {
      return { error: null };
    }

    const { error } = await supabaseAdmin.from("model_supersessions").upsert(
      rows.map((row) => ({ ...row, updated_at: new Date().toISOString() })),
      { onConflict: "deprecated_model_id" }
    );

    return {
      error: error ? { message: error.message } : null,
    };
  },
  async listEffectiveModelSupersessions() {
    const { data, error } = await supabaseAdmin
      .from("model_supersessions_effective")
      .select("deprecated_model_id");

    return {
      data:
        data?.map(
          (row) => (row as { deprecated_model_id: string }).deprecated_model_id
        ) ?? null,
      error: error ? { message: error.message } : null,
    };
  },
  async deleteModelSupersessions(deprecatedModelIds) {
    if (deprecatedModelIds.length === 0) {
      return { error: null };
    }

    const { error } = await supabaseAdmin
      .from("model_supersessions")
      .delete()
      .in("deprecated_model_id", deprecatedModelIds);

    return {
      error: error ? { message: error.message } : null,
    };
  },
  async upgradeDeprecatedModelPins() {
    const { data, error } = await supabaseAdmin.rpc(
      "upgrade_deprecated_model_pins"
    );

    return {
      data: (data ?? null) as Record<string, number> | null,
      error: error ? { message: error.message } : null,
    };
  },
  async upsertModelsBatch(batch) {
    const { error } = await supabaseAdmin
      .from("ai_models")
      .upsert(batch, { onConflict: "id" });

    return {
      error: error ? { message: error.message } : null,
    };
  },
};

export function buildStaleGatewayModelUpdate() {
  return {
    is_available: false,
    is_hidden: true,
    is_recommended: false,
    recommendation_bucket: null,
    recommendation_rank: null,
    recommendation_reason: null,
    recommended_at: null,
  };
}

function parseFinitePrice(value: string | undefined) {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFirstFinitePrice(...values: Array<string | undefined>) {
  for (const value of values) {
    const parsed = parseFinitePrice(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function mapGatewayPricing(pricing: GatewayModel["pricing"]) {
  return {
    pricing_input: parseFinitePrice(pricing?.input),
    pricing_output: parseFinitePrice(pricing?.output),
    pricing_cache_read: parseFirstFinitePrice(
      pricing?.cache_input,
      pricing?.cache_read,
      pricing?.input_cache_read
    ),
    pricing_cache_write: parseFirstFinitePrice(
      pricing?.cache_creation,
      pricing?.cache_write,
      pricing?.input_cache_write,
      pricing?.input_cache_creation
    ),
  };
}

function mapGatewayModelToCatalogRow(model: GatewayModel) {
  return {
    id: model.id,
    provider: model.owned_by,
    name: normalizeCatalogModelName(model.id, model.name),
    context_length: model.context_window ?? null,
    capabilities: model.tags ?? [],
    ...mapGatewayPricing(model.pricing),
    is_available: true,
    is_recommended: false,
    recommendation_bucket: null as "open" | "frontier" | null,
    recommendation_rank: null as number | null,
    recommendation_reason: null as string | null,
    recommended_at: null as string | null,
    updated_at: new Date().toISOString(),
  };
}

async function refreshProviderIcons(deps: SyncModelsDeps, providers: string[]) {
  let result: ProviderIconSyncResult;

  try {
    result = await deps.syncProviderIcons(providers);
  } catch (error) {
    result = {
      attempted: 0,
      skipped: 0,
      upserted: 0,
      failedProviders: providers,
    };
    console.warn("[sync-models] provider icon sync failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (result.failedProviders.length > 0) {
    console.warn("[sync-models] some provider icons were not refreshed", {
      providers: result.failedProviders,
    });
  }
  console.log("[sync-models] provider icon refresh completed", {
    providers: providers.length,
    attempted: result.attempted,
    skipped: result.skipped,
    upserted: result.upserted,
    failed: result.failedProviders.length,
  });
  return result;
}

export function createSyncModelsGetHandler(
  overrides: Partial<SyncModelsDeps> = {}
) {
  const deps: SyncModelsDeps = {
    ...defaultSyncModelsDeps,
    ...overrides,
  };

  return async function GET(req: Request) {
    const authResponse = deps.requireMachineApiAuth(
      req,
      "/api/cron/sync-models"
    );
    if (authResponse) return authResponse;

    let models: GatewayModel[];
    try {
      models = await deps.fetchGatewayModels();
    } catch {
      return NextResponse.json(
        { error: "Failed to fetch AI Gateway models" },
        { status: 502 }
      );
    }

    // Only sync language models with tool-use support (matches Vercel's
    // catalog filter for capabilities=text,tool-use), and drop anything
    // released more than 9 months ago. Models missing `released` are kept.
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 9);
    const cutoffSeconds = Math.floor(cutoff.getTime() / 1000);
    const languageModels = models.filter(
      (m) =>
        m.type === "language" &&
        m.tags?.includes("tool-use") &&
        (m.released === undefined || m.released >= cutoffSeconds)
    );
    const providerIconProviders = normalizeProviderIconProviders(
      languageModels.map((model) => model.owned_by)
    );

    // Anthropic business rule: same pricing + earlier version in the same
    // Claude family → offer the newest version only. Dropped rows fall into
    // the stale sweep below, which hides them in the catalog, and their
    // deprecated → successor mapping is recorded further down so saved
    // references get upgraded instead of being left on a retired model.
    const { retained: rows, supersessions } =
      resolveAnthropicNewestVersionPolicy(
        languageModels.map(mapGatewayModelToCatalogRow)
      );

    const recommendationMap = computeModelRecommendations(rows);
    const recommendedAt = new Date().toISOString();

    const rowsWithRecommendations = rows.map((row) => {
      const recommendation = recommendationMap.get(row.id);
      if (!recommendation) return row;
      return {
        ...row,
        is_recommended: true,
        recommendation_bucket: recommendation.bucket,
        recommendation_rank: recommendation.rank,
        recommendation_reason: recommendation.reason,
        recommended_at: recommendedAt,
      };
    });

    // Upsert in batches of 50
    const BATCH_SIZE = 50;
    let upserted = 0;
    for (let i = 0; i < rowsWithRecommendations.length; i += BATCH_SIZE) {
      const batch = rowsWithRecommendations.slice(i, i + BATCH_SIZE);
      const { error } = await deps.upsertModelsBatch(batch);

      if (error) {
        return NextResponse.json(
          { error: `Upsert failed at batch ${i}: ${error.message}`, upserted },
          { status: 500 }
        );
      }
      upserted += batch.length;
    }

    const { data: existingModelIds, error: existingModelIdsError } =
      await deps.listExistingModelIds();
    if (existingModelIdsError) {
      return NextResponse.json(
        {
          error: `Failed to load existing model ids: ${existingModelIdsError.message}`,
          upserted,
        },
        { status: 500 }
      );
    }

    const syncedModelIds = new Set(
      rowsWithRecommendations.map((row) => row.id)
    );
    const staleModelIds = (existingModelIds ?? []).filter(
      (modelId) => !syncedModelIds.has(modelId)
    );

    const markUnavailable = await deps.markModelsUnavailable(staleModelIds);
    if (markUnavailable.error) {
      return NextResponse.json(
        {
          error: `Failed to clear stale models: ${markUnavailable.error.message}`,
          upserted,
        },
        { status: 500 }
      );
    }

    // Record the deprecated → successor mapping and upgrade saved references.
    // Runs after the upsert so every successor already exists in ai_models
    // (the table FKs the successor), and after the stale sweep so the
    // reconciler sees final availability. Failures here are logged, not
    // fatal: the catalog sync itself succeeded, and the next run retries.
    const supersessionResult = await reconcileSupersessions(
      deps,
      supersessions,
      rows.map((row) => row.id)
    );

    let providerIconsScheduled = 0;
    let providerIconsStatus: "deferred" | "failed" | "not_scheduled" =
      "not_scheduled";
    if (providerIconProviders.length > 0) {
      try {
        deps.scheduleAfterResponse(async () => {
          await refreshProviderIcons(deps, providerIconProviders);
        });
        providerIconsScheduled = providerIconProviders.length;
        providerIconsStatus = "deferred";
      } catch (error) {
        providerIconsStatus = "failed";
        console.warn("[sync-models] could not schedule provider icon refresh", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      synced: upserted,
      total_gateway: languageModels.length,
      recommended: recommendationMap.size,
      // Deprecated compatibility fields are always zero because actual icon
      // work starts in after(). Consumers should use the status and scheduled
      // count instead of interpreting these as completed background metrics.
      provider_icons_attempted: 0,
      provider_icons_upserted: 0,
      provider_icons_failed: 0,
      provider_icons_status: providerIconsStatus,
      provider_icons_scheduled: providerIconsScheduled,
      ...supersessionResult,
    });
  };
}

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

type SupersessionReconcileResult = {
  // "aborted" means the reconcile bailed early on a database error; the counts
  // below describe what it managed before that, not what was needed.
  reconcile_status: "ok" | "aborted";
  supersessions_recorded: number;
  supersessions_purged: number;
  pins_upgraded: Record<string, number> | null;
};

// Every exit path returns the same keys, so nothing reading the JSON has to
// branch on which fields exist.
//
// A uniform shape alone would make a healthy no-op and an aborted run
// byte-identical — both are all-zeros with a null pins_upgraded, and the
// failure would live only in the cron log. `reconcile_status` is what actually
// tells them apart; the uniformity just keeps the shape stable.
function supersessionReconcileResult(
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

async function reconcileSupersessions(
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

  // Retract mappings the policy no longer agrees with. If this sync *retained*
  // a model, it is not superseded any more (e.g. its successor's pricing
  // diverged), so a stored mapping for it is stale and would keep moving pins
  // off a model that is on offer again.
  //
  // This, not the deprecated-side filter in model_supersessions_effective, is
  // the mechanism that makes retraction work. That filter cannot fire on its
  // own: mapGatewayModelToCatalogRow deliberately omits is_hidden so the stale
  // sweep's hide is durable, so a re-offered model keeps is_hidden = true and
  // never looks "on offer" to the view. The view check remains as a secondary
  // net for a model that is both available and visible.
  const retained = new Set(retainedModelIds);
  const retracted = (existing ?? [])
    .map((row) => row.deprecated_model_id)
    .filter((id) => retained.has(id));

  if (retracted.length > 0) {
    const deleted = await deps.deleteModelSupersessions(retracted);
    if (deleted.error) {
      // Bail before touching any pins. The stale row is still in the table and
      // the view's deprecated-side guard cannot catch it (a re-offered model
      // keeps is_hidden = true), so continuing would rewrite pins *off* a model
      // the policy just re-retained — and unlike the mapping table, that
      // rewrite does not heal on the next run: the pin has already moved.
      // Retrying the whole reconcile next run is the safe option.
      console.warn("[sync-models] failed to retract supersessions", {
        message: deleted.error.message,
        deprecatedModelIds: retracted,
      });
      return supersessionReconcileResult({ reconcile_status: "aborted" });
    }
    console.log("[sync-models] retracted supersessions", {
      deprecatedModelIds: retracted,
    });
  }

  // Named for what it holds: ids that are no longer deprecated. Only reached
  // once their rows are actually gone, so planning cannot reintroduce them.
  const retractedIds = new Set(retracted);
  const unresolvable: string[] = [];
  const writes = planSupersessionWrites(
    {
      existing: (existing ?? []).filter(
        (row) => !retractedIds.has(row.deprecated_model_id)
      ),
      discovered,
    },
    unresolvable
  );

  let purgedIds: ReadonlySet<string> = new Set();
  if (unresolvable.length > 0) {
    // Only reachable if model_supersessions has been corrupted into a cycle
    // (the CHECK constraint blocks the single-hop case, so this needs two bad
    // writes). Repair it rather than only logging: left in place, the affected
    // pins would stop upgrading permanently and the error line would repeat on
    // every cache refresh forever. Deleting is recoverable — the policy
    // re-derives the correct mapping from the catalog on a later sync.
    //
    // Unlike the retraction failure above, a failed purge does *not* bail out of
    // the reconcile, because a cycle cannot make the SQL half rewrite anything
    // wrongly. model_supersessions_effective only admits a row whose deprecated
    // model is NOT on offer and whose successor IS, and every edge of a cycle
    // would need its model to be both — so no edge of a cycle is ever in effect.
    // (The same property means in-effect edges never chain: each one ends at an
    // offered model, so the single-hop join is the whole answer.) Cycles matter
    // only to buildSupersessionMap, which already drops them and declines to
    // upgrade. Bailing here would trade a real repair for no extra safety.
    console.error("[sync-models] deleting unresolvable supersession chains", {
      deprecatedModelIds: unresolvable,
    });
    const purged = await deps.deleteModelSupersessions(unresolvable);
    if (purged.error) {
      console.warn("[sync-models] failed to delete unresolvable chains", {
        message: purged.error.message,
      });
    } else {
      purgedIds = new Set(unresolvable);
    }
  }

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
  await warnOnInertSupersessions(deps, [
    ...(existing ?? []).filter(
      (row) =>
        !retractedIds.has(row.deprecated_model_id) &&
        !purgedIds.has(row.deprecated_model_id)
    ),
    ...writes,
  ]);

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

export const GET = createSyncModelsGetHandler();
