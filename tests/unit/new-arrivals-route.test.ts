import assert from "node:assert/strict";
import test from "node:test";

async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/models/new-arrivals/route");
}

const seenAt = "2026-06-01T00:00:00.000Z";

function candidate(id: string, created_at: string | null) {
  return { id, name: id, provider: "anthropic", created_at, is_hidden: false };
}

// A single personal scope that can reach everything and restricts nothing — the
// default for tests that are not exercising team-scoping itself.
const fullAccessScopes = [
  {
    access: {
      hasGateway: true,
      hasOpenAi: true,
      hasAnthropic: true,
      hasOpenRouter: true,
    },
    allowlist: null,
  },
];

const allowAllScopes = async () => ({
  data: fullAccessScopes,
  error: null,
  degraded: false,
});

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
    "openrouter model is filtered out — unreachable in every scope"
  );
});

test("GET flags a degraded response when a team scope was dropped", async () => {
  // Dropping a team whose allowlist could not be read is the right fail-closed
  // call, but a silently shorter list is indistinguishable from a genuinely
  // empty one — the popup needs to be able to say "some models may be hidden".
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
  // Still a usable response — degrading is not failing.
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
  assert.equal(scopesLoaded, false, "no arrivals → skip the scope round-trip");
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
  // The cursor advances over the whole arrival set while the popup shows only
  // what is usable in some scope. If a team scope was dropped because its
  // allowlist could not be read, the models that team would have made usable
  // were never displayed — advancing past them marks them seen permanently and
  // they never resurface once the blip clears.
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

  // Still a 200 — the user's dismiss is accepted, it just is not recorded as
  // having seen everything. The popup reappears next poll with the full list.
  assert.equal(res.status, 200);
  assert.equal(advancedTo, null);
});

test("POST dismiss does not advance the cursor when the scope read fails outright", async () => {
  // A total scope-load failure loses strictly more information than the partial
  // one above, so holding the cursor for `degraded` while advancing on `error`
  // would be exactly backwards.
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
