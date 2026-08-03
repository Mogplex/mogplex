// Twice-daily AI Gateway model-catalog sync, scheduled in Trigger.dev as the
// long-term replacement for the vercel.json cron (which stays until this
// schedule has observed runs — the endpoint is idempotent, so both firing is
// harmless). The task drives the existing /api/cron/sync-models endpoint with
// machine auth rather than duplicating the sync logic; the endpoint's data
// backend (Supabase today, Neon after the flip) is the app deployment's
// concern, not this schedule's.
import { logger, schedules } from "@trigger.dev/sdk/v3";
import { buildAppUrl } from "@/lib/app-url";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

async function runScheduledModelSync() {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    throw new Error("CRON_SECRET is not configured in the Trigger environment");
  }

  const url = buildAppUrl("/api/cron/sync-models").toString();
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${cronSecret}` },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });

  const body = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok) {
    throw new Error(
      `sync-models endpoint returned ${response.status}: ${JSON.stringify(body)}`
    );
  }

  logger.log("model sync completed", { status: response.status, ...body });
  return body;
}

export const syncModelsTask = schedules.task({
  id: TRIGGER_TASK_IDS.syncModels,
  // Twice daily (06:00 / 18:00 UTC) per the catalog-freshness decision.
  cron: "0 6,18 * * *",
  maxDuration: 900,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 300_000,
    factor: 3,
  },
  run: async () => runScheduledModelSync(),
});
