import type { ProviderIconSyncResult } from "@/lib/models/provider-icon-sync";
import type { SyncModelsDeps } from "./types";

export async function refreshProviderIcons(
  deps: SyncModelsDeps,
  providers: string[]
) {
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
