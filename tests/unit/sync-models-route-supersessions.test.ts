import assert from "node:assert/strict";
import test from "node:test";

import { loadSyncModelsRoute } from "./helpers/sync-models-route-fixtures";

test("GET /api/cron/sync-models records supersessions and upgrades pinned models", async () => {
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  const recorded: Array<Array<Record<string, unknown>>> = [];
  let upgradeCalls = 0;

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
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
      data: ["anthropic/claude-opus-4.8"],
      error: null,
    }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    // Opus 4.7 was already recorded as superseded by 4.8; now that 4.8 is
    // itself superseded, both rows must move to Opus 5 so the stored mapping
    // stays a single hop to a live model.
    listModelSupersessions: async () => ({
      data: [
        {
          deprecated_model_id: "anthropic/claude-opus-4.7",
          successor_model_id: "anthropic/claude-opus-4.8",
        },
      ],
      error: null,
    }),
    recordModelSupersessions: async (rows) => {
      recorded.push(rows as unknown as Array<Record<string, unknown>>);
      return { error: null };
    },
    upgradeDeprecatedModelPins: async () => {
      upgradeCalls += 1;
      return { data: { flows: 2, agents: 1, profiles: 0 }, error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    recorded[0]
      ?.map((row) => ({
        deprecated: String(row.deprecated_model_id),
        successor: String(row.successor_model_id),
      }))
      .sort((left, right) => left.deprecated.localeCompare(right.deprecated)),
    [
      {
        deprecated: "anthropic/claude-opus-4.7",
        successor: "anthropic/claude-opus-5",
      },
      {
        deprecated: "anthropic/claude-opus-4.8",
        successor: "anthropic/claude-opus-5",
      },
    ]
  );
  assert.equal(upgradeCalls, 1);

  const body = (await response.json()) as {
    supersessions_recorded: number;
    pins_upgraded: Record<string, number>;
  };
  assert.equal(body.supersessions_recorded, 2);
  assert.deepEqual(body.pins_upgraded, { flows: 2, agents: 1, profiles: 0 });
});

test("GET /api/cron/sync-models still succeeds when the pin upgrade fails", async () => {
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();

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
    listExistingModelIds: async () => ({ data: [], error: null }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    listModelSupersessions: async () => ({ data: [], error: null }),
    recordModelSupersessions: async () => ({ error: null }),
    upgradeDeprecatedModelPins: async () => ({
      data: null,
      error: { message: "deadlock detected" },
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );

  // The catalog sync itself succeeded; the reconcile retries next run rather
  // than failing the cron and leaving the catalog un-synced.
  assert.equal(response.status, 200);
  const body = (await response.json()) as { pins_upgraded: unknown };
  assert.equal(body.pins_upgraded, null);
});

test("GET /api/cron/sync-models retracts a supersession the policy no longer agrees with", async () => {
  // Opus 5's pricing diverges, so Opus 4.8 is retained again and is no longer
  // superseded. The stored 4.8 -> 5 mapping must be deleted, otherwise it keeps
  // moving pins off a model that is on offer again. The deprecated-side filter
  // in model_supersessions_effective cannot do this on its own: the sync
  // deliberately omits is_hidden from its upsert so the stale sweep's hide is
  // durable, meaning a re-offered model never looks "on offer" to that view.
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  const deleted: string[][] = [];
  const recorded: Array<Array<Record<string, unknown>>> = [];

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
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
        // Dearer than 4.8, so the same-price rule no longer applies.
        pricing: { input: "0.00001", output: "0.00005" },
      },
    ],
    listExistingModelIds: async () => ({
      data: ["anthropic/claude-opus-4.8", "anthropic/claude-opus-5"],
      error: null,
    }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    listModelSupersessions: async () => ({
      data: [
        {
          deprecated_model_id: "anthropic/claude-opus-4.8",
          successor_model_id: "anthropic/claude-opus-5",
        },
      ],
      error: null,
    }),
    recordModelSupersessions: async (rows) => {
      recorded.push(rows as unknown as Array<Record<string, unknown>>);
      return { error: null };
    },
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
  assert.deepEqual(deleted, [["anthropic/claude-opus-4.8"]]);
  // Nothing re-recorded: the retracted mapping must not be written straight back.
  assert.deepEqual(recorded, []);
});

test("GET /api/cron/sync-models does not report a retraction as inert", async () => {
  // warnOnInertSupersessions lost its retractedIds parameter when it moved to
  // the post-write table, so the "deleted on purpose is not a surprise" rule
  // now lives only in how the caller builds that table. Pins it here: a row
  // this run retracted must not come back as an inert-supersession warning.
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const handler = createSyncModelsGetHandler({
      requireMachineApiAuth: () => null,
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
          // Diverged, so 4.8 is retained and its mapping is retracted.
          pricing: { input: "0.00001", output: "0.00005" },
        },
      ],
      listExistingModelIds: async () => ({
        data: ["anthropic/claude-opus-4.8", "anthropic/claude-opus-5"],
        error: null,
      }),
      markModelsUnavailable: async () => ({ error: null }),
      upsertModelsBatch: async () => ({ error: null }),
      listModelSupersessions: async () => ({
        data: [
          {
            deprecated_model_id: "anthropic/claude-opus-4.8",
            successor_model_id: "anthropic/claude-opus-5",
          },
        ],
        error: null,
      }),
      recordModelSupersessions: async () => ({ error: null }),
      deleteModelSupersessions: async () => ({ error: null }),
      // Nothing in effect, so any row still in the table would be called inert.
      listEffectiveModelSupersessions: async () => ({ data: [], error: null }),
      upgradeDeprecatedModelPins: async () => ({
        data: { flows: 0, agents: 0, profiles: 0 },
        error: null,
      }),
    });

    const response = await handler(
      new Request("http://localhost/api/cron/sync-models")
    );
    assert.equal(response.status, 200);
    const inertWarning = warnings.find(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("supersessions recorded but not in effect")
    );
    assert.equal(
      inertWarning,
      undefined,
      "a retracted supersession must not be reported as inert"
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("GET /api/cron/sync-models does not upgrade pins when retraction fails", async () => {
  // A surviving stale mapping would rewrite pins off a model the policy just
  // re-retained, and that rewrite does not heal on the next run — the pin has
  // already moved. So a failed retraction must skip the reconcile entirely.
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  let upgradeCalls = 0;

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
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
    ],
    listExistingModelIds: async () => ({
      data: ["anthropic/claude-opus-4.8"],
      error: null,
    }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    listModelSupersessions: async () => ({
      data: [
        {
          deprecated_model_id: "anthropic/claude-opus-4.8",
          successor_model_id: "anthropic/claude-opus-5",
        },
      ],
      error: null,
    }),
    recordModelSupersessions: async () => ({ error: null }),
    deleteModelSupersessions: async () => ({
      error: { message: "deadlock detected" },
    }),
    upgradeDeprecatedModelPins: async () => {
      upgradeCalls += 1;
      return { data: { flows: 0, agents: 0, profiles: 0 }, error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );

  // The catalog sync still succeeds; only the reconcile is deferred.
  assert.equal(response.status, 200);
  assert.equal(upgradeCalls, 0);
  const body = (await response.json()) as { pins_upgraded: unknown };
  assert.equal(body.pins_upgraded, null);
});
