import assert from "node:assert/strict";
import test from "node:test";

async function loadRequestLimits() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/request-limits");
}

test("chat limit policy allows requests under all thresholds", async () => {
  const { evaluateChatLimitPolicy } = await loadRequestLimits();
  const now = new Date("2026-03-23T12:00:00.000Z");

  const decision = evaluateChatLimitPolicy({
    activeChats: 1,
    hourlyStarts: ["2026-03-23T11:30:00.000Z"],
    dailyStarts: ["2026-03-23T02:00:00.000Z"],
    now,
  });

  assert.deepEqual(decision, { allowed: true });
});

test("chat limit policy denies when concurrent chat cap is reached", async () => {
  const { evaluateChatLimitPolicy } = await loadRequestLimits();

  const decision = evaluateChatLimitPolicy({
    activeChats: 2,
    hourlyStarts: [],
    dailyStarts: [],
    now: new Date("2026-03-23T12:00:00.000Z"),
  });

  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.code, "chat_rate_limited");
  assert.equal(decision.reason, "concurrent_chat_runs_exceeded");
});

test("snapshot build policy denies during cooldown when a snapshot already exists", async () => {
  const { evaluateSnapshotBuildLimitPolicy } = await loadRequestLimits();
  const now = new Date("2026-03-23T12:00:00.000Z");

  const decision = evaluateSnapshotBuildLimitPolicy({
    hourlyBuilds: [],
    dailyBuilds: [],
    hasSnapshot: true,
    lastSnapshotCreatedAt: "2026-03-23T11:50:00.000Z",
    now,
  });

  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.code, "snapshot_rate_limited");
  assert.equal(decision.reason, "snapshot_build_cooldown_active");
  assert.equal(decision.retryAfterSeconds, 300);
});

test("sandbox exec limit policy denies when minute burst is exceeded", async () => {
  const { evaluateSandboxExecLimitPolicy } = await loadRequestLimits();
  const now = new Date("2026-03-23T12:00:00.000Z");
  const minuteExecs = Array.from(
    { length: 20 },
    (_, index) => `2026-03-23T11:59:${String(index).padStart(2, "0")}.000Z`
  );

  const decision = evaluateSandboxExecLimitPolicy({
    minuteExecs,
    hourlyExecs: minuteExecs,
    now,
  });

  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.code, "sandbox_exec_rate_limited");
  assert.equal(decision.reason, "sandbox_exec_minutely_rate_exceeded");
});

test("external agent run policy denies per-key bursts before launching work", async () => {
  const { evaluateExternalAgentRunLimitPolicy } = await loadRequestLimits();
  const now = new Date("2026-03-23T12:00:00.000Z");
  const minutelyStarts = Array.from(
    { length: 10 },
    (_, index) => `2026-03-23T11:59:${String(index).padStart(2, "0")}.000Z`
  );

  const decision = evaluateExternalAgentRunLimitPolicy({
    minutelyStarts,
    hourlyStarts: minutelyStarts,
    dailyStarts: minutelyStarts,
    now,
  });

  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.code, "external_agent_run_rate_limited");
  assert.equal(decision.reason, "external_agent_run_minutely_rate_exceeded");
});

test("enforceExternalAgentRunLimits uses the atomic per-key admission RPC", async () => {
  const { enforceExternalAgentRunLimits, REQUEST_LIMITS } =
    await loadRequestLimits();
  const now = new Date("2026-03-23T12:00:00.000Z");

  const decision = await enforceExternalAgentRunLimits({
    userId: "user-123",
    apiKeyId: "key-1",
    repoId: "repo-123",
    now,
    rpc: async (fn, args) => {
      assert.equal(fn, "claim_external_agent_run_limit_admission");
      assert.equal(args?.p_user_id, "user-123");
      assert.equal(args?.p_api_key_id, "key-1");
      assert.equal(args?.p_repo_id, "repo-123");
      assert.equal(args?.p_now, now.toISOString());
      assert.equal(
        args?.p_minutely_limit,
        REQUEST_LIMITS.externalAgentRun.minutelyStarts.value
      );
      assert.equal(
        args?.p_minutely_window_seconds,
        REQUEST_LIMITS.externalAgentRun.minutelyStarts.windowSeconds
      );

      return {
        data: [
          {
            allowed: true,
            claim_id: "claim-123",
            code: null,
            error: null,
            reason: null,
            retry_after_seconds: null,
            limit_name: null,
            limit_value: null,
            window_seconds: null,
          },
        ],
        error: null,
      };
    },
  });

  assert.deepEqual(decision, {
    allowed: true,
    claimId: "claim-123",
  });
});

test("sandbox exec lock stale window matches the max sandbox lifetime", async () => {
  const { REQUEST_LIMITS } = await loadRequestLimits();
  const { MAX_SANDBOX_TIMEOUT_MS } = await import("../../lib/repo-settings");

  assert.equal(
    REQUEST_LIMITS.sandboxExec.lockStaleSeconds,
    Math.floor(MAX_SANDBOX_TIMEOUT_MS / 1000)
  );
});

test("enforceChatLimits returns an allowed claim id from the atomic RPC", async () => {
  const { enforceChatLimits } = await loadRequestLimits();
  const now = new Date("2026-03-23T12:00:00.000Z");

  const decision = await enforceChatLimits({
    userId: "user-123",
    repoId: "repo-123",
    sandboxId: "sandbox-123",
    now,
    rpc: async (fn, args) => {
      assert.equal(fn, "claim_chat_limit_admission");
      assert.equal(args?.p_user_id, "user-123");
      assert.equal(args?.p_repo_id, "repo-123");
      assert.equal(args?.p_sandbox_id, "sandbox-123");
      assert.equal(args?.p_now, now.toISOString());
      const { ACTIVE_CHAT_STALE_THRESHOLD_MS } =
        await import("../../lib/interactive-runs");
      assert.equal(
        args?.p_stale_threshold_seconds,
        Math.floor(ACTIVE_CHAT_STALE_THRESHOLD_MS / 1000)
      );

      return {
        data: [
          {
            allowed: true,
            claim_id: "claim-123",
            code: null,
            error: null,
            reason: null,
            retry_after_seconds: null,
            limit_name: null,
            limit_value: null,
            window_seconds: null,
          },
        ],
        error: null,
      };
    },
  });

  assert.deepEqual(decision, {
    allowed: true,
    claimId: "claim-123",
  });
});

test("enforceSandboxBootLimits maps denied RPC results into the public limit decision shape", async () => {
  const { enforceSandboxBootLimits } = await loadRequestLimits();
  const now = new Date("2026-03-23T12:00:00.000Z");

  const decision = await enforceSandboxBootLimits({
    userId: "user-123",
    repoId: "repo-123",
    now,
    rpc: async (fn, args) => {
      assert.equal(fn, "claim_sandbox_boot_limit_admission");
      assert.equal(args?.p_user_id, "user-123");
      assert.equal(args?.p_repo_id, "repo-123");
      assert.equal(args?.p_now, now.toISOString());

      return {
        data: [
          {
            allowed: false,
            claim_id: null,
            code: "sandbox_boot_rate_limited",
            error: "Sandbox boot rate limit exceeded",
            reason: "sandbox_boot_hourly_rate_exceeded",
            retry_after_seconds: 60,
            limit_name: "sandbox_boots_per_hour",
            limit_value: 5,
            window_seconds: 3600,
          },
        ],
        error: null,
      };
    },
  });

  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.code, "sandbox_boot_rate_limited");
  assert.equal(decision.retryAfterSeconds, 60);
  assert.deepEqual(decision.limit, {
    name: "sandbox_boots_per_hour",
    value: 5,
    windowSeconds: 3600,
  });
});
