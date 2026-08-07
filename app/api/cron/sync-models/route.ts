import { NextResponse } from "next/server";
import { resolveAnthropicNewestVersionPolicy } from "@/lib/models/anthropic-version-policy";
import { normalizeProviderIconProviders } from "@/lib/models/provider-icon";
import { computeModelRecommendations } from "@/lib/models/recommendations";

import type { SyncModelsDeps } from "./_lib/types";
import { defaultSyncModelsDeps } from "./_lib/deps";
import { mapGatewayModelToCatalogRow } from "./_lib/pricing";
import { reconcileSupersessions } from "./_lib/supersessions";
import {
  filterLanguageModels,
  markStaleModelsUnavailable,
  scheduleProviderIconRefresh,
  upsertModelsBatched,
} from "./_lib/sync-operations";

export { buildStaleGatewayModelUpdate } from "./_lib/pricing";

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

    let models: Awaited<ReturnType<typeof deps.fetchGatewayModels>>;
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
    const languageModels = filterLanguageModels(models);
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

    const upsertResult = await upsertModelsBatched(
      deps,
      rowsWithRecommendations
    );
    if (!upsertResult.success) {
      return NextResponse.json(
        {
          error: `Upsert failed at batch ${upsertResult.batchIndex}: ${upsertResult.errorMessage}`,
          upserted: upsertResult.upserted,
        },
        { status: 500 }
      );
    }

    const syncedModelIds = new Set(
      rowsWithRecommendations.map((row) => row.id)
    );
    const staleResult = await markStaleModelsUnavailable(deps, syncedModelIds);
    if (!staleResult.success) {
      return NextResponse.json(
        {
          error: `Failed to clear stale models: ${staleResult.errorMessage}`,
          upserted: upsertResult.upserted,
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

    const providerIconResult = scheduleProviderIconRefresh(
      deps,
      providerIconProviders
    );

    return NextResponse.json({
      synced: upsertResult.upserted,
      total_gateway: languageModels.length,
      recommended: recommendationMap.size,
      // Deprecated compatibility fields are always zero because actual icon
      // work starts in after(). Consumers should use the status and scheduled
      // count instead of interpreting these as completed background metrics.
      provider_icons_attempted: 0,
      provider_icons_upserted: 0,
      provider_icons_failed: 0,
      provider_icons_status: providerIconResult.status,
      provider_icons_scheduled: providerIconResult.scheduled,
      ...supersessionResult,
    });
  };
}

export const GET = createSyncModelsGetHandler();
