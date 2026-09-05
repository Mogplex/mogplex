import { expect, it } from "vitest";
import { createSandboxReaperRunner } from "./reaper";
import { MAX_SANDBOX_TIMEOUT_MS } from "@/lib/repo-settings";
import { buildActiveSandboxEvaluation } from "./reaper-decisions";
import {
  buildReaperSandboxRecord,
  buildReaperResolvedLiveness,
  buildPlatformSandboxCredentials,
} from "../../tests/unit/sandbox-reaper-test-harness";

const now = Date.parse("2026-09-05T03:00:00Z");

it.each([null, undefined, "invalid", "2020-01-01T00:00:00Z"])(
  "keeps original lifetime enforcement for a missing or invalid boot clock: %s",
  (boot) => {
    const record = {
      ...buildReaperSandboxRecord({
        created_at: new Date(now - 1000).toISOString(),
      }),
      last_boot_started_at: boot,
    };
    expect(
      buildActiveSandboxEvaluation(record, undefined, new Set(), now).ageMs
    ).toBe(1000);
  }
);

it.each([
  ["running", 60_000, undefined],
  ["installing", 60_000, undefined],
  ["running", MAX_SANDBOX_TIMEOUT_MS + 1, "stopped_max_lifetime"],
  ["installing", 11 * 60_000, "stopped_stuck_boot"],
] as const)(
  "uses the current %s session age (%i ms), not persistent record age",
  async (status, age, expectedStop) => {
    const record = {
      ...buildReaperSandboxRecord({
        status,
        persistent: true,
        created_at: new Date(now - 24 * 60 * 60_000).toISOString(),
        last_active_at: new Date(now).toISOString(),
      }),
      last_boot_started_at: new Date(now - age).toISOString(),
    };
    const stopped: string[] = [];
    const run = createSandboxReaperRunner({
      nowMs: () => now,
      withSupabaseAdminConnection: async (fn) => fn({} as never),
      loadActiveSandboxes: async () => [record],
      loadStaleStoppedSandboxes: async () => [],
      loadAbandonedPausedSandboxes: async () => [],
      loadBusySandboxIds: async () => new Set([record.id]),
      getPlatformSandboxCredentials: () => buildPlatformSandboxCredentials(),
      resolveCrossUserActiveSandboxLivenessMap: async () =>
        new Map([[record.id, buildReaperResolvedLiveness("running")]]),
      stopSandbox: async (_record, _credentials, options) => {
        stopped.push(options.onSuccessAction);
        return { stopped: true, action: options.onSuccessAction };
      },
    });
    await run();
    expect(stopped).toEqual(expectedStop ? [expectedStop] : []);
  }
);
