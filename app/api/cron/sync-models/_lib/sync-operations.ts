import type { SyncModelsDeps, GatewayModel } from "./types";
import { refreshProviderIcons } from "./provider-icons";

type UpsertResult =
  | { success: true; upserted: number }
  | {
      success: false;
      upserted: number;
      errorMessage: string;
      batchIndex: number;
    };

/**
 * Upsert models in batches of 50.
 */
export async function upsertModelsBatched(
  deps: SyncModelsDeps,
  rows: Parameters<SyncModelsDeps["upsertModelsBatch"]>[0]
): Promise<UpsertResult> {
  const BATCH_SIZE = 50;
  let upserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await deps.upsertModelsBatch(batch);

    if (error) {
      return {
        success: false,
        upserted,
        errorMessage: error.message,
        batchIndex: i,
      };
    }
    upserted += batch.length;
  }

  return { success: true, upserted };
}

type StaleMarkResult =
  | { success: true; staleIds: string[] }
  | { success: false; errorMessage: string };

/**
 * Find and mark stale models as unavailable.
 */
export async function markStaleModelsUnavailable(
  deps: SyncModelsDeps,
  syncedModelIds: Set<string>
): Promise<StaleMarkResult> {
  const { data: existingModelIds, error: existingModelIdsError } =
    await deps.listExistingModelIds();

  if (existingModelIdsError) {
    return { success: false, errorMessage: existingModelIdsError.message };
  }

  const staleModelIds = (existingModelIds ?? []).filter(
    (modelId) => !syncedModelIds.has(modelId)
  );

  const markUnavailable = await deps.markModelsUnavailable(staleModelIds);
  if (markUnavailable.error) {
    return { success: false, errorMessage: markUnavailable.error.message };
  }

  return { success: true, staleIds: staleModelIds };
}

type ProviderIconScheduleResult = {
  scheduled: number;
  status: "deferred" | "failed" | "not_scheduled";
};

/**
 * Schedule provider icon refresh as a deferred task.
 */
export function scheduleProviderIconRefresh(
  deps: SyncModelsDeps,
  providers: string[]
): ProviderIconScheduleResult {
  if (providers.length === 0) {
    return { scheduled: 0, status: "not_scheduled" };
  }

  try {
    deps.scheduleAfterResponse(async () => {
      await refreshProviderIcons(deps, providers);
    });
    return { scheduled: providers.length, status: "deferred" };
  } catch (error) {
    console.warn("[sync-models] could not schedule provider icon refresh", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { scheduled: 0, status: "failed" };
  }
}

/**
 * Filter gateway models to language models with tool-use support,
 * dropping models released more than 9 months ago.
 */
export function filterLanguageModels(models: GatewayModel[]): GatewayModel[] {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 9);
  const cutoffSeconds = Math.floor(cutoff.getTime() / 1000);

  return models.filter(
    (m) =>
      m.type === "language" &&
      m.tags?.includes("tool-use") &&
      (m.released === undefined || m.released >= cutoffSeconds)
  );
}
