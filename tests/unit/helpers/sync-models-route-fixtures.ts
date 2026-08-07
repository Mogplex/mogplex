import assert from "node:assert/strict";

export async function loadSyncModelsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const route = await import("../../../app/api/cron/sync-models/route");
  return {
    ...route,
    createSyncModelsGetHandler(
      overrides: Parameters<typeof route.createSyncModelsGetHandler>[0] = {}
    ) {
      return route.createSyncModelsGetHandler({
        syncProviderIcons: async () => ({
          attempted: 0,
          skipped: 0,
          upserted: 0,
          failedProviders: [],
        }),
        scheduleAfterResponse: (work) => {
          void work();
        },
        ...overrides,
      });
    },
  };
}

export function findBatchRow(
  batches: Array<Array<Record<string, unknown>>>,
  id: string
) {
  const row = batches[0]?.find((entry) => entry.id === id);
  assert.ok(row, `expected ${id} to be upserted`);
  return row;
}
