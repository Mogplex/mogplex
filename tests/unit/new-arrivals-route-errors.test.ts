import assert from "node:assert/strict";
import test from "node:test";
import {
  loadRoute,
  seenAt,
  candidate,
  allowAllScopes,
} from "./helpers/new-arrivals-route-fixtures";

test("PATCH updates the auto-enable setting", async () => {
  const { createNewArrivalsPatchHandler } = await loadRoute();
  let value: boolean | null = null;

  const handler = createNewArrivalsPatchHandler({
    requireUserId: async () => "user-1",
    setAutoEnableNewModels: async (_userId, next) => {
      value = next;
      return { error: null };
    },
  });

  const res = await handler(
    new Request("https://example.com/api/models/new-arrivals", {
      method: "PATCH",
      body: JSON.stringify({ autoEnable: false }),
    })
  );

  assert.equal(res.status, 200);
  assert.equal(value, false);
});

test("PATCH rejects a non-boolean autoEnable", async () => {
  const { createNewArrivalsPatchHandler } = await loadRoute();
  const handler = createNewArrivalsPatchHandler({
    requireUserId: async () => "user-1",
  });

  const res = await handler(
    new Request("https://example.com/api/models/new-arrivals", {
      method: "PATCH",
      body: JSON.stringify({ autoEnable: "yes" }),
    })
  );

  assert.equal(res.status, 400);
});

test("GET returns 500 when the profile load errors", async () => {
  const { createNewArrivalsGetHandler } = await loadRoute();
  const handler = createNewArrivalsGetHandler({
    getUserId: async () => "user-1",
    loadProfileModelSettings: async () => ({
      data: null,
      error: { message: "db down" },
    }),
  });

  const res = await handler();
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.error, "db down");
});

test("GET returns 404 when the profile is missing", async () => {
  const { createNewArrivalsGetHandler } = await loadRoute();
  const handler = createNewArrivalsGetHandler({
    getUserId: async () => "user-1",
    loadProfileModelSettings: async () => ({ data: null, error: null }),
  });

  const res = await handler();
  assert.equal(res.status, 404);
});

test("GET returns 500 when resolving candidate models errors", async () => {
  const { createNewArrivalsGetHandler } = await loadRoute();
  const handler = createNewArrivalsGetHandler({
    getUserId: async () => "user-1",
    loadProfileModelSettings: async () => ({
      data: { auto_enable_new_models: true, models_seen_at: seenAt },
      error: null,
    }),
    listCandidateModels: async () => ({
      data: null,
      error: { message: "catalog unavailable" },
    }),
    listUserPreferenceModelIds: async () => ({ data: [], error: null }),
  });

  const res = await handler();
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.error, "catalog unavailable");
});

test("POST disable returns 500 when the disable write fails", async () => {
  const { createNewArrivalsPostHandler } = await loadRoute();
  let advanceCalled = false;

  const handler = createNewArrivalsPostHandler({
    requireUserId: async () => "user-1",
    loadProfileModelSettings: async () => ({
      data: { auto_enable_new_models: true, models_seen_at: seenAt },
      error: null,
    }),
    listCandidateModels: async () => ({
      data: [candidate("anthropic/new", "2026-06-15T00:00:00.000Z")],
      error: null,
    }),
    listUserPreferenceModelIds: async () => ({ data: [], error: null }),
    loadUserUsabilityScopes: allowAllScopes,
    setAutoEnableNewModels: async () => ({ error: null }),
    disableModelsForUser: async () => ({ error: { message: "disable boom" } }),
    advanceModelsSeenAt: async () => {
      advanceCalled = true;
      return { error: null };
    },
  });

  const res = await handler(
    new Request("https://example.com/api/models/new-arrivals", {
      method: "POST",
      body: JSON.stringify({ action: "disable" }),
    })
  );

  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.error, "disable boom");
  assert.equal(advanceCalled, false, "cursor must not advance on failure");
});

test("POST returns 500 when advancing the cursor fails", async () => {
  const { createNewArrivalsPostHandler } = await loadRoute();
  const handler = createNewArrivalsPostHandler({
    requireUserId: async () => "user-1",
    loadProfileModelSettings: async () => ({
      data: { auto_enable_new_models: true, models_seen_at: seenAt },
      error: null,
    }),
    listCandidateModels: async () => ({
      data: [candidate("anthropic/new", "2026-06-15T00:00:00.000Z")],
      error: null,
    }),
    listUserPreferenceModelIds: async () => ({ data: [], error: null }),
    loadUserUsabilityScopes: allowAllScopes,
    advanceModelsSeenAt: async () => ({ error: { message: "cursor boom" } }),
  });

  const res = await handler(
    new Request("https://example.com/api/models/new-arrivals", {
      method: "POST",
      body: JSON.stringify({ action: "dismiss" }),
    })
  );

  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.error, "cursor boom");
});
