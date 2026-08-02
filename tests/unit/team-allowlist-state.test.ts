import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWLIST_FAILURE_LOG_TTL_MS,
  allowlistPermitsModel,
  claimAllowlistSignalSlot,
  createLoadTeamAllowlistState,
  isModelAllowlistUnavailableError,
  modelAllowlistUnavailableError,
  teamAllowlistMatcher,
  __resetAllowlistFailureLogForTests,
} from "../../lib/team-capabilities";

test.beforeEach(() => {
  // Module-level dedupe state: without this a second failing read for the same
  // team and message inside the TTL logs nothing, making these order-dependent.
  __resetAllowlistFailureLogForTests();
});

test("loadTeamAllowlistState retries once and returns the recovered read", async () => {
  // This read is on the critical path of every team-scoped invocation and a
  // failure now denies the call, so a single blip must not deny. Unlike a
  // cache, a retry re-reads the live row and so has no staleness window.
  let calls = 0;
  const load = createLoadTeamAllowlistState(async () => {
    calls += 1;
    if (calls === 1) {
      return { allowlist: null, ok: false, reason: "connection reset" };
    }
    return { allowlist: ["openai/gpt-5"], ok: true };
  });

  assert.deepEqual(await load("team-1"), {
    status: "restricted",
    models: ["openai/gpt-5"],
  });
  assert.equal(calls, 2);
});

test("loadTeamAllowlistState reports unknown after the retry also fails", async () => {
  let calls = 0;
  const load = createLoadTeamAllowlistState(async () => {
    calls += 1;
    return { allowlist: null, ok: false, reason: "connection reset" };
  });

  const state = await load("team-1");

  assert.equal(state.status, "unknown");
  assert.equal(
    state.status === "unknown" ? state.reason : null,
    "connection reset"
  );
  // Bounded at one retry: beyond that we are queueing on a struggling database.
  assert.equal(calls, 2);
});

test("loadTeamAllowlistState does not retry a successful read", async () => {
  let calls = 0;
  const load = createLoadTeamAllowlistState(async () => {
    calls += 1;
    return { allowlist: null, ok: true };
  });

  assert.deepEqual(await load("team-1"), { status: "unrestricted" });
  assert.equal(calls, 1);
});

test("loadTeamAllowlistState treats a missing team row as unrestricted, not unknown", async () => {
  // A team with no row has no restriction to violate — that is genuinely
  // unrestricted, and must not be conflated with a failed read.
  const load = createLoadTeamAllowlistState(async () => ({
    allowlist: null,
    ok: true,
  }));

  assert.deepEqual(await load("team-1"), { status: "unrestricted" });
});

test("modelAllowlistUnavailableError is detected by code, not message", () => {
  const tagged = modelAllowlistUnavailableError();
  assert.equal(isModelAllowlistUnavailableError(tagged), true);

  // Same copy, no code: HTTP status mapping must not fire on the message, so
  // rewording the copy cannot change which status a surface returns.
  assert.equal(
    isModelAllowlistUnavailableError(new Error(tagged.message)),
    false
  );
  assert.equal(isModelAllowlistUnavailableError(null), false);
  assert.equal(isModelAllowlistUnavailableError("string error"), false);
});

test("isModelAllowlistUnavailableError walks the cause chain", () => {
  // This is the case that actually happens: lib/flows/server.ts re-throws the
  // error wrapped in a FlowServiceError. Without chain-walking the HTTP
  // surfaces fall back to a permanent status, disagreeing with the automation
  // classifier, whose readErrorCode has always walked the chain.
  const wrapped = new Error("Failed to resolve agent template", {
    cause: modelAllowlistUnavailableError(),
  });
  assert.equal(isModelAllowlistUnavailableError(wrapped), true);

  const doubleWrapped = new Error("outer", { cause: wrapped });
  assert.equal(isModelAllowlistUnavailableError(doubleWrapped), true);

  const unrelated = new Error("outer", { cause: new Error("inner") });
  assert.equal(isModelAllowlistUnavailableError(unrelated), false);
});

test("isModelAllowlistUnavailableError terminates on a cyclic cause chain", () => {
  // A self-referential cause must not hang a request thread.
  const cyclic = new Error("loop") as Error & { cause?: unknown };
  cyclic.cause = cyclic;
  assert.equal(isModelAllowlistUnavailableError(cyclic), false);

  const a = new Error("a") as Error & { cause?: unknown };
  const b = new Error("b") as Error & { cause?: unknown };
  a.cause = b;
  b.cause = a;
  assert.equal(isModelAllowlistUnavailableError(a), false);
});

test("claimAllowlistSignalSlot grants a slot once per window", () => {
  assert.equal(claimAllowlistSignalSlot("s", "team-a", "boom").emit, true);
  assert.equal(claimAllowlistSignalSlot("s", "team-a", "boom").emit, false);

  // A different cause for the same team gets through — the second cause is
  // usually the informative one.
  assert.equal(claimAllowlistSignalSlot("s", "team-a", "other").emit, true);
  // And scopes do not suppress each other.
  assert.equal(claimAllowlistSignalSlot("t", "team-a", "boom").emit, true);
});

test("claimAllowlistSignalSlot suppresses rather than evicting a live claim", () => {
  // Under cap pressure a throttle must fail toward emitting *less*. Evicting a
  // live claim would re-open its slot and let that pair emit again, partially
  // restoring the amplification the throttle exists to prevent.
  for (let index = 0; index < 128; index++) {
    assert.equal(
      claimAllowlistSignalSlot("s", `team-${index}`, "boom").emit,
      true,
      `team-${index} should claim a slot`
    );
  }

  // Cap reached: a new distinct pair is refused...
  assert.equal(
    claimAllowlistSignalSlot("s", "team-overflow", "boom").emit,
    false
  );
  // ...and crucially the earliest claim is still held, not evicted.
  assert.equal(claimAllowlistSignalSlot("s", "team-0", "boom").emit, false);

  // A different scope has its own budget: one noisy surface must not
  // hard-suppress the first occurrence on another during a broad incident.
  assert.equal(claimAllowlistSignalSlot("other", "team-0", "boom").emit, true);
});

test("claimAllowlistSignalSlot keys on the cause, not the raw message text", () => {
  // Postgres messages embed variable detail. Keyed on the raw string, every
  // attempt would be a distinct key — the throttle would stop throttling during
  // the outage it exists for, and could then fill the cap with noise.
  assert.equal(
    claimAllowlistSignalSlot(
      "s",
      "team-a",
      "canceling statement due to statement timeout after 30014ms (pid 4821)"
    ).emit,
    true
  );
  // Same cause, different numbers: suppressed.
  assert.equal(
    claimAllowlistSignalSlot(
      "s",
      "team-a",
      "canceling statement due to statement timeout after 29887ms (pid 5177)"
    ).emit,
    false
  );
  // Genuinely different cause: still gets through.
  assert.equal(
    claimAllowlistSignalSlot("s", "team-a", "permission denied for table teams")
      .emit,
    true
  );
});

test("allowlistPermitsModel and teamAllowlistMatcher both deny on unknown", () => {
  // Unreachable from the resolver today because `unknown` throws before these
  // run, but they are the last line of defence if that ordering ever changes —
  // and a permissive default here would be a silent fail-open.
  const unknown = { status: "unknown", reason: "read failed" } as const;
  assert.equal(allowlistPermitsModel(unknown, "openai/gpt-5"), false);
  assert.equal(teamAllowlistMatcher(unknown)("openai/gpt-5"), false);

  const unrestricted = { status: "unrestricted" } as const;
  assert.equal(allowlistPermitsModel(unrestricted, "openai/gpt-5"), true);
  assert.equal(teamAllowlistMatcher(unrestricted)("openai/gpt-5"), true);

  const restricted = {
    status: "restricted",
    models: ["openai/gpt-5"],
  } as const;
  assert.equal(allowlistPermitsModel(restricted, "openai/gpt-5"), true);
  assert.equal(allowlistPermitsModel(restricted, "openai/gpt-4"), false);
  assert.equal(teamAllowlistMatcher(restricted)("openai/gpt-5"), true);
  assert.equal(teamAllowlistMatcher(restricted)("openai/gpt-4"), false);
});

test("claimAllowlistSignalSlot reports how many emissions the window swallowed", (t) => {
  // A throttled compliance row that cannot say how much it stands for is a
  // sample of unknown size — an operator cannot tell one denial from a
  // thousand. The next granted slot carries what the last window refused.
  t.mock.timers.enable({ apis: ["Date"], now: 0 });

  assert.deepEqual(claimAllowlistSignalSlot("s", "team-a", "boom"), {
    emit: true,
    suppressedSinceLast: 0,
  });

  for (let index = 0; index < 5; index++) {
    assert.equal(claimAllowlistSignalSlot("s", "team-a", "boom").emit, false);
  }

  // Past the TTL, so the slot is claimable again — and reports the five it hid.
  t.mock.timers.tick(ALLOWLIST_FAILURE_LOG_TTL_MS + 1);
  assert.deepEqual(claimAllowlistSignalSlot("s", "team-a", "boom"), {
    emit: true,
    suppressedSinceLast: 5,
  });

  // Counting restarts from the new claim rather than accumulating forever.
  t.mock.timers.tick(ALLOWLIST_FAILURE_LOG_TTL_MS + 1);
  assert.deepEqual(claimAllowlistSignalSlot("s", "team-a", "boom"), {
    emit: true,
    suppressedSinceLast: 0,
  });
});

test("a repeated read failure logs once per window, not per call", async (t) => {
  // Regression guard. `shouldLogAllowlistFailure` used to return a boolean and
  // was later changed to an object; the read path kept `if (!fn(...)) return`,
  // which is always false for an object — so this log never suppressed and the
  // request-rate flood the throttle exists to prevent was live. Asserting the
  // observable behaviour catches that; asserting the helper's return value
  // would not have.
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    const load = createLoadTeamAllowlistState(async () => ({
      allowlist: null,
      ok: false,
      reason: "connection reset",
    }));

    for (let call = 0; call < 4; call++) {
      const state = await load("team-flood");
      assert.equal(state.status, "unknown");
    }
  } finally {
    console.error = originalError;
  }

  const failureLines = logged.filter(
    (args) => args[0] === "Team model allowlist lookup failed"
  );
  assert.equal(
    failureLines.length,
    1,
    "four failed reads inside one window must log once"
  );
});
