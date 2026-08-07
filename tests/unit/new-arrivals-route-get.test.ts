import assert from "node:assert/strict";
import test from "node:test";
import {
  loadRoute,
  seenAt,
  candidate,
  fullAccessScopes,
  allowAllScopes,
} from "./helpers/new-arrivals-route-fixtures";

test("GET surfaces new models for the popup without advancing seen-at when feature is on", async () => {
  const { createNewArrivalsGetHandler } = await loadRoute();
  let advanced = false;
  let disabled: string[] = [];

  const handler = createNewArrivalsGetHandler({
    getUserId: async () => "user-1",
    loadProfileModelSettings: async () => ({
      data: { auto_enable_new_models: true, models_seen_at: seenAt },
      error: null,
    }),
    listCandidateModels: async () => ({
      data: [
        candidate("anthropic/old", "2026-05-01T00:00:00.000Z"),
        candidate("anthropic/new", "2026-06-15T00:00:00.000Z"),
      ],
      error: null,
      degraded: false,
    }),
    listUserPreferenceModelIds: async () => ({ data: [], error: null }),
    loadUserUsabilityScopes: allowAllScopes,
    disableModelsForUser: async (_userId, ids) => {
      disabled = ids;
      return { error: null };
    },
    advanceModelsSeenAt: async () => {
      advanced = true;
      return { error: null };
    },
  });

  const res = await handler();
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(
    body.models.map((m: { id: string }) => m.id),
    ["anthropic/new"]
  );
  assert.equal(body.autoEnable, true);
  assert.equal(advanced, false, "seen-at must persist until acknowledged");
  assert.deepEqual(disabled, []);
});

test("GET hides a new model the user cannot use in any scope", async () => {
  const { createNewArrivalsGetHandler } = await loadRoute();
  let scopesLoadedFor: string | null = null;

  const handler = createNewArrivalsGetHandler({
    getUserId: async () => "user-1",
    loadProfileModelSettings: async () => ({
      data: { auto_enable_new_models: true, models_seen_at: seenAt },
      error: null,
    }),
    listCandidateModels: async () => ({
      data: [
        // Reachable by gateway in the personal scope.
        candidate("anthropic/new", "2026-06-15T00:00:00.000Z"),
        // OpenRouter requires an OpenRouter key the user lacks everywhere.
        candidate("openrouter/exotic", "2026-06-16T00:00:00.000Z"),
      ],
      error: null,
      degraded: false,
    }),
    listUserPreferenceModelIds: async () => ({ data: [], error: null }),
    loadUserUsabilityScopes: async (userId) => {
      scopesLoadedFor = userId;
      return {
        data: [
          {
            access: {
              hasGateway: true,
              hasOpenAi: false,
              hasAnthropic: true,
              hasOpenRouter: false,
            },
            allowlist: null,
          },
        ],
        error: null,
        degraded: false,
      };
    },
  });

  const res = await handler();
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(scopesLoadedFor, "user-1");
  assert.deepEqual(
    body.models.map((m: { id: string }) => m.id),
    ["anthropic/new"],
    "openrouter model is filtered out - unreachable in every scope"
  );
});

test("GET flags a degraded response when a team scope was dropped", async () => {
  const { createNewArrivalsGetHandler } = await loadRoute();

  const handler = createNewArrivalsGetHandler({
    getUserId: async () => "user-1",
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
      data: [
        {
          access: {
            hasGateway: true,
            hasOpenAi: false,
            hasAnthropic: true,
            hasOpenRouter: false,
          },
          allowlist: null,
        },
      ],
      error: null,
      degraded: true,
    }),
  });

  const body = await (await handler()).json();

  assert.equal(body.degraded, true);
  // Still a usable response - degrading is not failing.
  assert.deepEqual(
    body.models.map((m: { id: string }) => m.id),
    ["anthropic/new"]
  );
});

test("GET omits the degraded flag when every scope resolved", async () => {
  const { createNewArrivalsGetHandler } = await loadRoute();

  const handler = createNewArrivalsGetHandler({
    getUserId: async () => "user-1",
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
      data: [
        {
          access: {
            hasGateway: true,
            hasOpenAi: false,
            hasAnthropic: true,
            hasOpenRouter: false,
          },
          allowlist: null,
        },
      ],
      error: null,
      degraded: false,
    }),
  });

  const body = await (await handler()).json();

  // Absent, not `false`: the popup should not have to distinguish those.
  assert.equal("degraded" in body, false);
});

test("GET surfaces a new model usable only via a team allowlist + team key", async () => {
  const { createNewArrivalsGetHandler } = await loadRoute();

  const handler = createNewArrivalsGetHandler({
    getUserId: async () => "user-1",
    loadProfileModelSettings: async () => ({
      data: { auto_enable_new_models: true, models_seen_at: seenAt },
      error: null,
    }),
    listCandidateModels: async () => ({
      data: [candidate("openrouter/team-only", "2026-06-15T00:00:00.000Z")],
      error: null,
    }),
    listUserPreferenceModelIds: async () => ({ data: [], error: null }),
    loadUserUsabilityScopes: async () => ({
      data: [
        // Personal scope cannot reach OpenRouter.
        {
          access: {
            hasGateway: true,
            hasOpenAi: false,
            hasAnthropic: false,
            hasOpenRouter: false,
          },
          allowlist: null,
        },
        // A team supplies an OpenRouter key and allows the model.
        {
          access: {
            hasGateway: true,
            hasOpenAi: false,
            hasAnthropic: false,
            hasOpenRouter: true,
          },
          allowlist: new Set(["openrouter/team-only"]),
        },
      ],
      error: null,
      degraded: false,
    }),
  });

  const res = await handler();
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(
    body.models.map((m: { id: string }) => m.id),
    ["openrouter/team-only"]
  );
});

test("GET hides a reachable model disallowed by every team allowlist", async () => {
  const { createNewArrivalsGetHandler } = await loadRoute();

  const handler = createNewArrivalsGetHandler({
    getUserId: async () => "user-1",
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
      // User only operates inside a team whose allowlist excludes the model;
      // there is no personal scope where it is allowed.
      data: [
        {
          access: {
            hasGateway: true,
            hasOpenAi: true,
            hasAnthropic: true,
            hasOpenRouter: true,
          },
          allowlist: new Set(["anthropic/some-other-model"]),
        },
      ],
      error: null,
      degraded: false,
    }),
  });

  const res = await handler();
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body.models, []);
});

test("GET returns 500 when usability scopes fail to load", async () => {
  const { createNewArrivalsGetHandler } = await loadRoute();

  const handler = createNewArrivalsGetHandler({
    getUserId: async () => "user-1",
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
      error: { message: "vault down" },
      degraded: false,
    }),
  });

  const res = await handler();
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.error, "vault down");
});

test("GET does not load usability scopes when nothing is new", async () => {
  const { createNewArrivalsGetHandler } = await loadRoute();
  let scopesLoaded = false;

  const handler = createNewArrivalsGetHandler({
    getUserId: async () => "user-1",
    loadProfileModelSettings: async () => ({
      data: { auto_enable_new_models: true, models_seen_at: seenAt },
      error: null,
    }),
    listCandidateModels: async () => ({
      data: [candidate("anthropic/old", "2026-05-01T00:00:00.000Z")],
      error: null,
    }),
    listUserPreferenceModelIds: async () => ({ data: [], error: null }),
    loadUserUsabilityScopes: async () => {
      scopesLoaded = true;
      return { data: fullAccessScopes, error: null, degraded: false };
    },
  });

  const res = await handler();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.models, []);
  assert.equal(scopesLoaded, false, "no arrivals -> skip the scope round-trip");
});

test("GET disables new models and advances seen-at to the newest created_at when feature is off", async () => {
  const { createNewArrivalsGetHandler } = await loadRoute();
  let advancedTo: string | null = null;
  let disabled: string[] = [];

  const handler = createNewArrivalsGetHandler({
    getUserId: async () => "user-1",
    loadProfileModelSettings: async () => ({
      data: { auto_enable_new_models: false, models_seen_at: seenAt },
      error: null,
    }),
    listCandidateModels: async () => ({
      data: [
        candidate("anthropic/new", "2026-06-15T00:00:00.000Z"),
        candidate("anthropic/newer", "2026-06-16T00:00:00.000Z"),
      ],
      error: null,
      degraded: false,
    }),
    listUserPreferenceModelIds: async () => ({ data: [], error: null }),
    disableModelsForUser: async (_userId, ids) => {
      disabled = ids;
      return { error: null };
    },
    advanceModelsSeenAt: async (_userId, value) => {
      advancedTo = value;
      return { error: null };
    },
  });

  const res = await handler();
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body.models, []);
  assert.equal(body.autoEnable, false);
  assert.deepEqual(disabled.sort(), ["anthropic/new", "anthropic/newer"]);
  // Cursor moves to the newest processed created_at, not the wall clock.
  assert.equal(advancedTo, "2026-06-16T00:00:00.000Z");
});

test("GET leaves the cursor untouched when feature is off and nothing is new", async () => {
  const { createNewArrivalsGetHandler } = await loadRoute();
  let advanceCalled = false;
  let disableCalled = false;

  const handler = createNewArrivalsGetHandler({
    getUserId: async () => "user-1",
    loadProfileModelSettings: async () => ({
      data: { auto_enable_new_models: false, models_seen_at: seenAt },
      error: null,
    }),
    listCandidateModels: async () => ({
      data: [candidate("anthropic/old", "2026-05-01T00:00:00.000Z")],
      error: null,
    }),
    listUserPreferenceModelIds: async () => ({ data: [], error: null }),
    disableModelsForUser: async () => {
      disableCalled = true;
      return { error: null };
    },
    advanceModelsSeenAt: async () => {
      advanceCalled = true;
      return { error: null };
    },
  });

  const res = await handler();
  assert.equal(res.status, 200);
  assert.equal(advanceCalled, false);
  assert.equal(disableCalled, false);
});

test("GET returns empty for anonymous callers", async () => {
  const { createNewArrivalsGetHandler } = await loadRoute();
  const handler = createNewArrivalsGetHandler({
    getUserId: async () => undefined,
  });

  const res = await handler();
  const body = await res.json();
  assert.deepEqual(body, { models: [], autoEnable: true });
});
