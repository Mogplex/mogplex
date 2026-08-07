import assert from "node:assert/strict";
import test from "node:test";
import {
  loadRoute,
  seenAt,
  candidate,
  fullAccessScopes,
  allowAllScopes,
} from "./helpers/new-arrivals-route-fixtures";

test("POST disable flips the flag off before disabling, then advances the cursor", async () => {
  const { createNewArrivalsPostHandler } = await loadRoute();
  let autoEnableSet: boolean | null = null;
  let disabled: string[] = [];
  let advancedTo: string | null = null;
  const order: string[] = [];

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
    disableModelsForUser: async (_userId, ids) => {
      order.push("disable");
      disabled = ids;
      return { error: null };
    },
    setAutoEnableNewModels: async (_userId, value) => {
      order.push("flag");
      autoEnableSet = value;
      return { error: null };
    },
    advanceModelsSeenAt: async (_userId, value) => {
      advancedTo = value;
      return { error: null };
    },
  });

  const res = await handler(
    new Request("https://example.com/api/models/new-arrivals", {
      method: "POST",
      body: JSON.stringify({ action: "disable" }),
    })
  );

  assert.equal(res.status, 200);
  assert.equal(autoEnableSet, false);
  assert.deepEqual(disabled, ["anthropic/new"]);
  assert.equal(advancedTo, "2026-06-15T00:00:00.000Z");
  // Flag is flipped off first so a later disable failure self-heals via GET.
  assert.deepEqual(order, ["flag", "disable"]);
});

test("POST disable stops before disabling when the flag write fails", async () => {
  const { createNewArrivalsPostHandler } = await loadRoute();
  let disableCalled = false;
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
    setAutoEnableNewModels: async () => ({ error: { message: "flag boom" } }),
    disableModelsForUser: async () => {
      disableCalled = true;
      return { error: null };
    },
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

  assert.equal(res.status, 500);
  assert.equal(disableCalled, false, "disable must not run if the flag failed");
  assert.equal(advanceCalled, false, "cursor must not advance on failure");
});

test("POST dismiss advances the cursor to the newest seen model without disabling", async () => {
  const { createNewArrivalsPostHandler } = await loadRoute();
  let autoEnableTouched = false;
  let disableTouched = false;
  let advancedTo: string | null = null;

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
    setAutoEnableNewModels: async () => {
      autoEnableTouched = true;
      return { error: null };
    },
    disableModelsForUser: async () => {
      disableTouched = true;
      return { error: null };
    },
    advanceModelsSeenAt: async (_userId, value) => {
      advancedTo = value;
      return { error: null };
    },
  });

  const res = await handler(
    new Request("https://example.com/api/models/new-arrivals", {
      method: "POST",
      body: JSON.stringify({ action: "dismiss" }),
    })
  );

  assert.equal(res.status, 200);
  assert.equal(advancedTo, "2026-06-15T00:00:00.000Z");
  assert.equal(autoEnableTouched, false);
  assert.equal(disableTouched, false);
});

test("POST dismiss does not advance the cursor on a degraded read", async () => {
  const { createNewArrivalsPostHandler } = await loadRoute();
  let advancedTo: string | null = null;

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
    loadUserUsabilityScopes: async () => ({
      data: fullAccessScopes,
      error: null,
      degraded: true,
    }),
    advanceModelsSeenAt: async (_userId, value) => {
      advancedTo = value;
      return { error: null };
    },
  });

  const res = await handler(
    new Request("https://example.com/api/models/new-arrivals", {
      method: "POST",
      body: JSON.stringify({ action: "dismiss" }),
    })
  );

  // Still a 200 - the user's dismiss is accepted, it just is not recorded as
  // having seen everything. The popup reappears next poll with the full list.
  assert.equal(res.status, 200);
  assert.equal(advancedTo, null);
});

test("POST dismiss does not advance the cursor when the scope read fails outright", async () => {
  const { createNewArrivalsPostHandler } = await loadRoute();
  let advancedTo: string | null = null;

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
    loadUserUsabilityScopes: async () => ({
      data: null,
      error: { message: "team_members unreadable" },
      degraded: false,
    }),
    advanceModelsSeenAt: async (_userId, value) => {
      advancedTo = value;
      return { error: null };
    },
  });

  const res = await handler(
    new Request("https://example.com/api/models/new-arrivals", {
      method: "POST",
      body: JSON.stringify({ action: "dismiss" }),
    })
  );

  assert.equal(res.status, 200);
  assert.equal(advancedTo, null);
});

test("POST dismiss leaves the cursor untouched when nothing is new", async () => {
  const { createNewArrivalsPostHandler } = await loadRoute();
  let advanceCalled = false;

  const handler = createNewArrivalsPostHandler({
    requireUserId: async () => "user-1",
    loadProfileModelSettings: async () => ({
      data: { auto_enable_new_models: true, models_seen_at: seenAt },
      error: null,
    }),
    listCandidateModels: async () => ({
      data: [candidate("anthropic/old", "2026-05-01T00:00:00.000Z")],
      error: null,
    }),
    listUserPreferenceModelIds: async () => ({ data: [], error: null }),
    loadUserUsabilityScopes: allowAllScopes,
    advanceModelsSeenAt: async () => {
      advanceCalled = true;
      return { error: null };
    },
  });

  const res = await handler(
    new Request("https://example.com/api/models/new-arrivals", {
      method: "POST",
      body: JSON.stringify({ action: "dismiss" }),
    })
  );

  assert.equal(res.status, 200);
  assert.equal(advanceCalled, false);
});

test("POST rejects unknown actions", async () => {
  const { createNewArrivalsPostHandler } = await loadRoute();
  const handler = createNewArrivalsPostHandler({
    requireUserId: async () => "user-1",
  });

  const res = await handler(
    new Request("https://example.com/api/models/new-arrivals", {
      method: "POST",
      body: JSON.stringify({ action: "nope" }),
    })
  );

  assert.equal(res.status, 400);
});
