import assert from "node:assert/strict";
import test from "node:test";
import { loadSandboxResumeRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildSandboxRouteContextFailure,
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
} from "./sandbox-record-route-test-harness";
import { buildLoadedResumeContext } from "./helpers/sandbox-resume-route-fixtures";

test("POST /api/sandbox/[id]/resume rejects non-paused sandboxes", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext({ status: "running" })) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /not paused/i);
});

test("POST /api/sandbox/[id]/resume rejects pausing sandboxes with a conflict before waking the VM", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();
  let getSandboxCalls = 0;

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext({
        status: "pausing",
        health_status: "pausing",
      })) as never,
    getSandbox: async () => {
      getSandboxCalls += 1;
      return {} as never;
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.match(payload.error, /paus/i);
  assert.equal(getSandboxCalls, 0);
});

test("POST /api/sandbox/[id]/resume rejects non-persistent paused records", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext({ persistent: false })) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /not persistent/i);
});

test("POST /api/sandbox/[id]/resume rejects records still booting", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext({ sandbox_id: "pending" })) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 409);
});

test("POST /api/sandbox/[id]/resume forwards route-context failures", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildSandboxRouteContextFailure({
        status: 401,
        error: "Unauthorized",
      })) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 401);
});

test("POST /api/sandbox/[id]/resume denies active-limit conflicts before waking the VM", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();
  let getSandboxCalls = 0;

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext()) as never,
    enforceSandboxBootLimits: (async () => ({
      allowed: false,
      status: 429,
      code: "sandbox_boot_rate_limited",
      error: "Too many active sandboxes",
      reason: "active_sandbox_limit_exceeded",
      retryAfterSeconds: 15,
      limit: {
        name: "active_sandboxes",
        value: 3,
        windowSeconds: 0,
      },
    })) as never,
    getSandbox: async () => {
      getSandboxCalls += 1;
      return {} as never;
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "15");
  assert.equal(getSandboxCalls, 0);
});

test("POST /api/sandbox/[id]/resume returns 502 when Sandbox.get throws", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();
  const releasedClaims: string[] = [];

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext()) as never,
    enforceSandboxBootLimits: (async () => ({
      allowed: true,
      claimId: "claim-resume-1",
    })) as never,
    getSandbox: async () => {
      throw new Error("vm unavailable");
    },
    releaseLimitClaim: (async (input: { claimId: string }) => {
      releasedClaims.push(input.claimId);
      return true;
    }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.match(payload.error, /vm unavailable/);
  assert.deepEqual(releasedClaims, ["claim-resume-1"]);
});
