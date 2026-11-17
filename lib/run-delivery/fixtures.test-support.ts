import { buildRunRow } from "@/tests/unit/helpers/mogplex-api-runs-fixtures";
import type { DeliveryRun } from "./store";
import type { DeliverySnapshot } from "./types";

export function deliveryRun(): DeliveryRun {
  return {
    ...buildRunRow({
      status: "success",
      metadata: { delivery_follow_through: true },
      working_branch: "feature/signing",
      base_branch: "main",
    }),
    repo_full_name: "acme/widgets",
  };
}
export function deliverySnapshot(): DeliverySnapshot {
  return {
    observedAt: "2026-11-17T00:00:01.000Z",
    repairRevision: "revision-1",
    pullRequest: {
      number: 42,
      url: "https://github.com/acme/widgets/pull/42",
      state: "open",
      draft: false,
      headSha: "head-1",
      mergeSha: null,
    },
    checks: {
      state: "failure",
      failed: ["tests"],
      pending: 0,
      total: 1,
      incomplete: false,
    },
    review: { state: "none", unresolved: 0, incomplete: false },
    deployment: { state: "not_reported", environment: null, url: null },
  };
}
