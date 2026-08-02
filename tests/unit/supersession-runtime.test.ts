import assert from "node:assert/strict";
import test, { mock } from "node:test";

// The module reads supabaseAdmin at call time, so the stub is installed by
// intercepting the client module before first import.
type Row = { deprecated_model_id: string; successor_model_id: string };

type Stub = {
  supersessions: { data: Row[] | null; error: { message: string } | null };
  profile: {
    data: { auto_enable_new_models: boolean } | null;
    error: { message: string } | null;
  };
  preference: {
    data: { is_enabled: boolean } | null;
    error: { message: string } | null;
  };
  throwOnSupersessions: Error | null;
  supersessionSelects: number;
  profileSelects: number;
};

const stub: Stub = {
  supersessions: { data: [], error: null },
  profile: { data: { auto_enable_new_models: true }, error: null },
  preference: { data: null, error: null },
  throwOnSupersessions: null,
  supersessionSelects: 0,
  profileSelects: 0,
};

const OPUS_47 = "anthropic/claude-opus-4.7";
const OPUS_5 = "anthropic/claude-opus-5";
const USER = "11111111-1111-1111-1111-111111111111";
const UNRESTRICTED = { status: "unrestricted" } as const;

function reset() {
  stub.supersessions = {
    data: [{ deprecated_model_id: OPUS_47, successor_model_id: OPUS_5 }],
    error: null,
  };
  stub.profile = { data: { auto_enable_new_models: true }, error: null };
  stub.preference = { data: null, error: null };
  stub.throwOnSupersessions = null;
  stub.supersessionSelects = 0;
  stub.profileSelects = 0;
}

async function loadRuntime() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

  const adminModule = await import("../../lib/supabase/admin");
  const admin = adminModule.supabaseAdmin as unknown as {
    from: (table: string) => unknown;
  };

  admin.from = (table: string) => {
    if (table === "model_supersessions_effective") {
      return {
        select: async () => {
          stub.supersessionSelects += 1;
          if (stub.throwOnSupersessions) throw stub.throwOnSupersessions;
          return stub.supersessions;
        },
      };
    }

    // profiles / user_model_preferences share a chainable eq() shape ending in
    // maybeSingle().
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => {
        if (table === "profiles") {
          stub.profileSelects += 1;
          return stub.profile;
        }
        return stub.preference;
      },
    };
    return chain;
  };

  return import("../../lib/models/supersession-runtime");
}

test("upgrades a superseded pin for a consenting user", async () => {
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();

  assert.equal(
    await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
    OPUS_5
  );
  assert.equal(
    await runtime.resolveRuntimeModelId(USER, "openai/gpt-5.4", UNRESTRICTED),
    "openai/gpt-5.4"
  );
});

test("honours auto_enable_new_models = false on published automations", async () => {
  // The opt-out has to hold on this path too: published flow versions are not
  // rewritten, so the runtime resolver is what actually executes for them.
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();
  stub.profile = { data: { auto_enable_new_models: false }, error: null };

  assert.equal(
    await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
    OPUS_47
  );
});

test("never invokes a successor the user explicitly disabled", async () => {
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();
  stub.preference = { data: { is_enabled: false }, error: null };

  assert.equal(
    await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
    OPUS_47
  );
});

test("an explicitly enabled successor is still upgraded", async () => {
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();
  stub.preference = { data: { is_enabled: true }, error: null };

  assert.equal(
    await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
    OPUS_5
  );
});

test("fails closed when the consent lookup errors", async () => {
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();
  stub.profile = { data: null, error: { message: "timeout" } };

  assert.equal(
    await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
    OPUS_47
  );
});

test("fails closed when the profile row is missing", async () => {
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();
  stub.profile = { data: null, error: null };

  assert.equal(
    await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
    OPUS_47
  );
});

test("defers to a team allowlist that does not permit the successor", async () => {
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();

  assert.equal(
    await runtime.resolveRuntimeModelId(USER, OPUS_47, {
      status: "restricted",
      models: [OPUS_47],
    }),
    OPUS_47
  );
  assert.equal(
    await runtime.resolveRuntimeModelId(USER, OPUS_47, {
      status: "restricted",
      models: [OPUS_47, OPUS_5],
    }),
    OPUS_5
  );
  assert.equal(
    await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
    OPUS_5
  );
});

test("caches a successful supersession load across calls", async () => {
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();

  await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED);
  await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED);
  await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED);

  assert.equal(stub.supersessionSelects, 1);
});

test("a failed load is retried on a short TTL, not the full success TTL", async () => {
  // Two properties at once. A failure must not switch upgrades off for the full
  // 5-minute success TTL (the original bug), but it also must not make every
  // resolve reissue the query while the database is still down.
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();
  stub.supersessions = { data: null, error: { message: "connection reset" } };

  mock.timers.enable({ apis: ["Date"] });
  try {
    assert.equal(
      await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
      OPUS_47
    );
    assert.equal(stub.supersessionSelects, 1);

    // Still inside the failure TTL: load-shed rather than pile on.
    mock.timers.tick(5_000);
    assert.equal(
      await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
      OPUS_47
    );
    assert.equal(stub.supersessionSelects, 1);

    // Past the failure TTL but far short of the 5-minute success TTL: recovery
    // must happen here, which is what the original bug got wrong.
    stub.supersessions = {
      data: [{ deprecated_model_id: OPUS_47, successor_model_id: OPUS_5 }],
      error: null,
    };
    mock.timers.tick(16_000);
    assert.equal(
      await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
      OPUS_5
    );
    assert.equal(stub.supersessionSelects, 2);
  } finally {
    mock.timers.reset();
  }
});

test("a successful load is held for the long TTL", async () => {
  // Confirms the failure TTL above is genuinely shorter than the success TTL,
  // rather than both happening to be short.
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();

  mock.timers.enable({ apis: ["Date"] });
  try {
    assert.equal(
      await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
      OPUS_5
    );
    assert.equal(stub.supersessionSelects, 1);

    mock.timers.tick(60_000);
    assert.equal(
      await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
      OPUS_5
    );
    assert.equal(stub.supersessionSelects, 1);
  } finally {
    mock.timers.reset();
  }
});

test("a thrown load behaves the same as a failed one", async () => {
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();
  stub.throwOnSupersessions = new Error("socket hang up");

  mock.timers.enable({ apis: ["Date"] });
  try {
    assert.equal(
      await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
      OPUS_47
    );

    stub.throwOnSupersessions = null;
    mock.timers.tick(16_000);
    assert.equal(
      await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
      OPUS_5
    );
  } finally {
    mock.timers.reset();
  }
});

test("concurrent resolves share a single supersession query", async () => {
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();

  const results = await Promise.all([
    runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
    runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
    runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
  ]);

  assert.deepEqual(results, [OPUS_5, OPUS_5, OPUS_5]);
  assert.equal(stub.supersessionSelects, 1);
});

test("consent is not consulted when nothing was superseded", async () => {
  // Keeps the hot path free: the per-user read only happens when an upgrade
  // would actually apply.
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();
  stub.profile = { data: null, error: { message: "should not be called" } };

  assert.equal(
    await runtime.resolveRuntimeModelId(USER, "openai/gpt-5.4", UNRESTRICTED),
    "openai/gpt-5.4"
  );
});

test("fails closed when the team allowlist could not be read", async () => {
  // loadTeamModelAllowlist collapses "no allowlist" and "read failed" into
  // null; treating the latter as unrestricted would fail open and could swap a
  // permitted pin for a model the team deliberately excluded.
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();

  assert.equal(
    await runtime.resolveRuntimeModelId(USER, OPUS_47, {
      status: "unknown",
      reason: "read failed",
    }),
    OPUS_47
  );

  // Same null allowlist, but known to be genuinely unrestricted.
  assert.equal(
    await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
    OPUS_5
  );
});

test("consent is memoised across nodes within a run", async () => {
  // An automation with several nodes pinned to the same retired model must not
  // pay two queries per node.
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();

  await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED);
  await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED);
  await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED);

  assert.equal(stub.profileSelects, 1);
});

test("memoised consent expires so a changed opt-out is honoured", async () => {
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();

  mock.timers.enable({ apis: ["Date"] });
  try {
    assert.equal(
      await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
      OPUS_5
    );

    // User turns the opt-out off; once the short TTL lapses it must be seen.
    stub.profile = { data: { auto_enable_new_models: false }, error: null };
    mock.timers.tick(6_000);
    assert.equal(
      await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
      OPUS_47
    );
  } finally {
    mock.timers.reset();
  }
});

test("a failed consent read is not cached", async () => {
  // The throw path already evicted; the error-result path must behave the same,
  // otherwise a transient error suppresses upgrades for the whole TTL.
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();
  stub.profile = { data: null, error: { message: "timeout" } };

  assert.equal(
    await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
    OPUS_47
  );

  // Recovers on the very next call, with no TTL wait.
  stub.profile = { data: { auto_enable_new_models: true }, error: null };
  assert.equal(
    await runtime.resolveRuntimeModelId(USER, OPUS_47, UNRESTRICTED),
    OPUS_5
  );
});

test("returns the caller's id unchanged on every non-upgrade path", async () => {
  // The trim exists only to look the pin up, so no path should normalise the
  // caller's value as a side effect — including the skip paths.
  const runtime = await loadRuntime();
  reset();
  runtime.resetSupersessionCacheForTests();
  const padded = ` ${OPUS_47} `;

  // Not superseded at all.
  assert.equal(
    await runtime.resolveRuntimeModelId(USER, " openai/gpt-5.4 ", UNRESTRICTED),
    " openai/gpt-5.4 "
  );

  // Skipped: allowlist unknown.
  assert.equal(
    await runtime.resolveRuntimeModelId(USER, padded, {
      status: "unknown",
      reason: "read failed",
    }),
    padded
  );

  // Skipped: allowlist forbids the successor.
  assert.equal(
    await runtime.resolveRuntimeModelId(USER, padded, {
      status: "restricted",
      models: [OPUS_47],
    }),
    padded
  );

  // Skipped: user opted out.
  stub.profile = { data: { auto_enable_new_models: false }, error: null };
  assert.equal(
    await runtime.resolveRuntimeModelId(USER, padded, UNRESTRICTED),
    padded
  );
});
