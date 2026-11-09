import assert from "node:assert/strict";
import test from "node:test";
import { toggleModelPreference } from "../../hooks/use-models";
import {
  buildCatalogModel,
  controlledFetch,
  createHarness,
  deferred,
  revalidationsOf,
  settle,
  type ToggleOptions,
} from "../support/models-toggle-harness";

test("toggleModelPreference saves a click made during an in-flight save after it, using the clicked value", async () => {
  const model = buildCatalogModel({
    id: "provider/in-order",
    is_enabled: false,
  });
  const harness = createHarness({ model });
  const { bodies, pending, fetchFn, ok } = controlledFetch(harness, model);
  // Both clicks see the same stale catalog, as before a re-render.
  const options = {
    modelId: model.id,
    catalog: [model],
    mutate: harness.mutate,
    fetchFn,
    toastFn: harness.toastFn,
  };

  const first = toggleModelPreference({ ...options, enabled: true });
  await settle();
  const second = toggleModelPreference({ ...options, enabled: false });
  await settle();
  assert.deepEqual(bodies, [true]);

  pending[0]!.resolve(ok());
  await settle();
  assert.deepEqual(bodies, [true, false]);
  pending[1]!.resolve(ok());
  await Promise.all([first, second]);

  assert.equal(harness.data.catalog[0]?.is_enabled, false);
  assert.equal(harness.toastCalls.length, 0);
  // Only the newest save refreshes the catalog.
  assert.equal(revalidationsOf(harness), 1);
});

test("toggleModelPreference skips saves that a newer click replaced before they started", async () => {
  const model = buildCatalogModel({ id: "provider/skip", is_enabled: false });
  const harness = createHarness({ model });
  const { bodies, pending, fetchFn, ok } = controlledFetch(harness, model);
  const options = {
    modelId: model.id,
    catalog: [model],
    mutate: harness.mutate,
    fetchFn,
    toastFn: harness.toastFn,
  };

  const first = toggleModelPreference({ ...options, enabled: true });
  await settle();
  const second = toggleModelPreference({ ...options, enabled: false });
  const third = toggleModelPreference({ ...options, enabled: true });
  await settle();
  pending[0]!.resolve(ok());
  await settle();
  pending[1]?.resolve(ok());
  await Promise.all([first, second, third]);

  assert.deepEqual(bodies, [true, true]);
  assert.equal(harness.data.catalog[0]?.is_enabled, true);
});

test("toggleModelPreference keeps a click made during a refresh instead of the refreshed value", async () => {
  const model = buildCatalogModel({
    id: "provider/refresh",
    is_enabled: false,
  });
  const harness = createHarness({ model });
  const { bodies, pending, fetchFn, ok } = controlledFetch(harness, model);
  const refreshGate = deferred<void>();
  let gateRefresh = true;
  const mutate: ToggleOptions["mutate"] = async (update, shouldRevalidate) => {
    if (update === undefined && gateRefresh) {
      gateRefresh = false;
      await refreshGate.promise;
    }
    return harness.mutate(update, shouldRevalidate);
  };
  const options = {
    modelId: model.id,
    catalog: [model],
    mutate,
    fetchFn,
    toastFn: harness.toastFn,
  };

  const first = toggleModelPreference({ ...options, enabled: true });
  await settle();
  pending[0]!.resolve(ok());
  await settle();
  // The first save is refreshing; the user clicks again.
  const second = toggleModelPreference({ ...options, enabled: false });
  await settle();
  assert.deepEqual(bodies, [true]);

  refreshGate.resolve();
  await settle();
  assert.equal(harness.data.catalog[0]?.is_enabled, false);
  assert.deepEqual(bodies, [true, false]);
  pending[1]!.resolve(ok());
  await Promise.all([first, second]);

  assert.equal(harness.data.catalog[0]?.is_enabled, false);
  assert.equal(revalidationsOf(harness), 2);
});

test("toggleModelPreference lets a newer click settle the state when an older save fails", async () => {
  const model = buildCatalogModel({
    id: "provider/older-failure",
    is_enabled: false,
  });
  const harness = createHarness({ model });
  const { pending, fetchFn, ok } = controlledFetch(harness, model);
  const options = {
    modelId: model.id,
    catalog: [model],
    mutate: harness.mutate,
    fetchFn,
    toastFn: harness.toastFn,
  };

  const first = toggleModelPreference({ ...options, enabled: true });
  await settle();
  const second = toggleModelPreference({ ...options, enabled: false });
  await settle();
  pending[0]!.resolve(new Response(null, { status: 500 }));
  await settle();
  pending[1]!.resolve(ok());
  await Promise.all([first, second]);

  assert.equal(harness.toastCalls.length, 0);
  assert.equal(revalidationsOf(harness), 1);
  assert.equal(harness.data.catalog[0]?.is_enabled, false);
});

test("toggleModelPreference orders clicks by when they happened, not when the screen update finished", async () => {
  const model = buildCatalogModel({
    id: "provider/call-order",
    is_enabled: false,
  });
  const harness = createHarness({ model });
  const { bodies, pending, fetchFn, ok } = controlledFetch(harness, model);
  const firstShown = deferred<void>();
  let optimisticCalls = 0;
  const mutate: ToggleOptions["mutate"] = async (update, shouldRevalidate) => {
    if (typeof update === "function" && optimisticCalls++ === 0) {
      // The first click's screen update finishes after the second's.
      await firstShown.promise;
    }
    return harness.mutate(update, shouldRevalidate);
  };
  const options = {
    modelId: model.id,
    catalog: [model],
    mutate,
    fetchFn,
    toastFn: harness.toastFn,
  };

  const first = toggleModelPreference({ ...options, enabled: true });
  const second = toggleModelPreference({ ...options, enabled: false });
  await settle();
  firstShown.resolve();
  await settle();
  for (const response of pending) response.resolve(ok());
  await settle();
  for (const response of pending) response.resolve(ok());
  await Promise.all([first, second]);

  // The second click is the newest, so its value is the one saved.
  assert.deepEqual(bodies, [false]);
  assert.equal(harness.data.catalog[0]?.is_enabled, false);
});

test(
  "toggleModelPreference gives up on a save that never settles so the next click is saved",
  { timeout: 5000 },
  async () => {
    const model = buildCatalogModel({
      id: "provider/stalled",
      is_enabled: false,
    });
    const harness = createHarness({ model });
    const bodies: boolean[] = [];
    const fetchFn: typeof fetch = (_input, init) => {
      const enabled = JSON.parse(String(init?.body)).is_enabled as boolean;
      bodies.push(enabled);
      if (bodies.length === 1) {
        // The first request hangs until its signal aborts it.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason)
          );
        });
      }
      const updated = { ...model, is_enabled: enabled };
      harness.serverData.catalog = [updated];
      harness.serverData.models = enabled ? [updated] : [];
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    const options = {
      modelId: model.id,
      catalog: [model],
      mutate: harness.mutate,
      fetchFn,
      toastFn: harness.toastFn,
      saveTimeoutMs: 20,
    };

    // Node doesn't keep the process alive for AbortSignal.timeout; browsers do.
    // Bounded, so a regression fails the test instead of hanging the run.
    const keepAlive = setTimeout(() => undefined, 3000);
    try {
      const first = toggleModelPreference({ ...options, enabled: true });
      await settle();
      const second = toggleModelPreference({ ...options, enabled: false });
      await Promise.all([first, second]);
    } finally {
      clearTimeout(keepAlive);
    }

    assert.deepEqual(bodies, [true, false]);
    assert.equal(harness.data.catalog[0]?.is_enabled, false);
    assert.equal(harness.toastCalls.length, 0);
  }
);
