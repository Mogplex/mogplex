import assert from "node:assert/strict";
import test from "node:test";

import { loadSyncModelsRoute } from "./helpers/sync-models-route-fixtures";

test("GET /api/cron/sync-models deletes a corrupted supersession cycle", async () => {
  // A cycle means the table needs two bad writes to reach, but if it ever does,
  // leaving it makes the affected pins stop upgrading permanently. The cron
  // repairs it so the policy can re-derive the mapping from the catalog.
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  const deleted: string[][] = [];

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [
      {
        id: "anthropic/claude-opus-5",
        name: "Claude Opus 5",
        owned_by: "anthropic",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.000005", output: "0.000025" },
      },
    ],
    listExistingModelIds: async () => ({
      data: ["anthropic/claude-opus-5"],
      error: null,
    }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    listModelSupersessions: async () => ({
      data: [
        { deprecated_model_id: "model-a", successor_model_id: "model-b" },
        { deprecated_model_id: "model-b", successor_model_id: "model-a" },
      ],
      error: null,
    }),
    recordModelSupersessions: async () => ({ error: null }),
    deleteModelSupersessions: async (ids) => {
      deleted.push([...ids]);
      return { error: null };
    },
    upgradeDeprecatedModelPins: async () => ({
      data: { flows: 0, agents: 0, profiles: 0 },
      error: null,
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    deleted.map((ids) => [...ids].sort()),
    [["model-a", "model-b"]]
  );
  const body = (await response.json()) as { supersessions_purged: number };
  assert.equal(body.supersessions_purged, 2);
});

test("GET /api/cron/sync-models reports zero purged when the purge delete fails", async () => {
  // The count is rows actually removed. Reporting the attempted count would
  // claim a repair that did not happen, and the cycle is still in the table.
  // The reconcile deliberately continues: no edge of a cycle can be in effect
  // (each would need its model both on and off offer), so the pin rewrite that
  // follows cannot act on one.
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  let upgradeCalls = 0;

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [
      {
        id: "anthropic/claude-opus-5",
        name: "Claude Opus 5",
        owned_by: "anthropic",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.000005", output: "0.000025" },
      },
    ],
    listExistingModelIds: async () => ({
      data: ["anthropic/claude-opus-5"],
      error: null,
    }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    listModelSupersessions: async () => ({
      data: [
        { deprecated_model_id: "model-a", successor_model_id: "model-b" },
        { deprecated_model_id: "model-b", successor_model_id: "model-a" },
      ],
      error: null,
    }),
    recordModelSupersessions: async () => ({ error: null }),
    deleteModelSupersessions: async () => ({
      error: { message: "delete failed" },
    }),
    listEffectiveModelSupersessions: async () => ({ data: [], error: null }),
    upgradeDeprecatedModelPins: async () => {
      upgradeCalls += 1;
      return { data: { flows: 0, agents: 0, profiles: 0 }, error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    supersessions_purged: number;
    reconcile_status: string;
  };
  assert.equal(body.supersessions_purged, 0);
  // Not aborted: a failed purge deliberately continues (no edge of a cycle can
  // be in effect), so the run really did complete.
  assert.equal(body.reconcile_status, "ok");
  assert.equal(upgradeCalls, 1);
});

test("GET /api/cron/sync-models checks freshly written supersessions for inertness", async () => {
  // The check used to be passed the pre-write snapshot, so a row recorded by
  // this very run — the one most worth knowing about — was never checked.
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  let checkedTable: string[] = [];
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const handler = createSyncModelsGetHandler({
      requireMachineApiAuth: () => null,
      // Opus 4.8 and Opus 5 at identical pricing: 4.8 is superseded, so this
      // run records 4.8 -> 5 for the first time.
      fetchGatewayModels: async () => [
        {
          id: "anthropic/claude-opus-4.8",
          name: "Claude Opus 4.8",
          owned_by: "anthropic",
          type: "language",
          context_window: 1_000_000,
          tags: ["reasoning", "tool-use"],
          pricing: { input: "0.000005", output: "0.000025" },
        },
        {
          id: "anthropic/claude-opus-5",
          name: "Claude Opus 5",
          owned_by: "anthropic",
          type: "language",
          context_window: 1_000_000,
          tags: ["reasoning", "tool-use"],
          pricing: { input: "0.000005", output: "0.000025" },
        },
      ],
      listExistingModelIds: async () => ({
        data: ["anthropic/claude-opus-4.8", "anthropic/claude-opus-5"],
        error: null,
      }),
      markModelsUnavailable: async () => ({ error: null }),
      upsertModelsBatch: async () => ({ error: null }),
      listModelSupersessions: async () => ({ data: [], error: null }),
      recordModelSupersessions: async () => ({ error: null }),
      deleteModelSupersessions: async () => ({ error: null }),
      // Nothing is in effect, so the row just written is inert.
      listEffectiveModelSupersessions: async () => {
        checkedTable = ["called"];
        return { data: [], error: null };
      },
      upgradeDeprecatedModelPins: async () => ({
        data: { flows: 0, agents: 0, profiles: 0 },
        error: null,
      }),
    });

    const response = await handler(
      new Request("http://localhost/api/cron/sync-models")
    );
    assert.equal(response.status, 200);
    // With the old pre-write snapshot (empty) the check returned early and this
    // dep was never reached.
    assert.deepEqual(checkedTable, ["called"]);
    const inertWarning = warnings.find(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("supersessions recorded but not in effect")
    );
    assert.ok(inertWarning, "expected an inert-supersession warning");
    assert.deepEqual(
      (inertWarning?.[1] as { deprecatedModelIds: string[] })
        .deprecatedModelIds,
      ["anthropic/claude-opus-4.8"]
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("GET /api/cron/sync-models marks an aborted reconcile distinctly from a clean no-op", async () => {
  // All-zeros with a null pins_upgraded is what a healthy run with nothing to
  // do returns too, so without a discriminator the JSON cannot tell "nothing
  // needed doing" from "we bailed on a database error" — the failure would live
  // only in the cron log.
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();

  const gatewayModel = {
    id: "anthropic/claude-opus-5",
    name: "Claude Opus 5",
    owned_by: "anthropic",
    type: "language" as const,
    context_window: 1_000_000,
    tags: ["reasoning", "tool-use"],
    pricing: { input: "0.000005", output: "0.000025" },
  };
  const baseDeps = {
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [gatewayModel],
    listExistingModelIds: async () => ({
      data: ["anthropic/claude-opus-5"],
      error: null,
    }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    recordModelSupersessions: async () => ({ error: null }),
    deleteModelSupersessions: async () => ({ error: null }),
    listEffectiveModelSupersessions: async () => ({ data: [], error: null }),
    upgradeDeprecatedModelPins: async () => ({
      data: { flows: 0, agents: 0, profiles: 0 },
      error: null,
    }),
  };

  const healthy = await createSyncModelsGetHandler({
    ...baseDeps,
    listModelSupersessions: async () => ({ data: [], error: null }),
  })(new Request("http://localhost/api/cron/sync-models"));

  const aborted = await createSyncModelsGetHandler({
    ...baseDeps,
    listModelSupersessions: async () => ({
      data: null,
      error: { message: "connection reset" },
    }),
  })(new Request("http://localhost/api/cron/sync-models"));

  const healthyBody = (await healthy.json()) as Record<string, unknown>;
  const abortedBody = (await aborted.json()) as Record<string, unknown>;

  assert.equal(healthyBody.reconcile_status, "ok");
  assert.equal(abortedBody.reconcile_status, "aborted");
  // The counts really are identical — the status is the only thing separating
  // them, which is the point.
  assert.equal(healthyBody.supersessions_recorded, 0);
  assert.equal(abortedBody.supersessions_recorded, 0);
  assert.equal(abortedBody.supersessions_purged, 0);
  assert.equal(abortedBody.pins_upgraded, null);
});
