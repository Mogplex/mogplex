import assert from "node:assert/strict";
import test from "node:test";
import { APIError } from "@vercel/sandbox";
import {
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
} from "./sandbox-record-route-test-harness";
import {
  buildOwnedSandboxServiceRecord,
  buildSandboxServiceAiAccess,
  buildSandboxServiceRouteAuth,
  loadSandboxExecRouteModule,
} from "./sandbox-service-route-test-harness";

function providerLookupNotFoundError(message: string) {
  return new APIError(
    new Response(JSON.stringify({ error: { code: "not_found", message } }), {
      status: 404,
      statusText: "Not Found",
    }),
    {
      message: "Status code 404 is not ok",
      json: { error: { code: "not_found", message } },
      sandboxName: "sandbox-runtime-123",
    }
  );
}

test("POST /api/sandbox/[id]/exec returns 429 when exec limits are exceeded", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();
  const callOrder: string[] = [];
  let releasedLock: { sandboxId: string; token: string } | null = null;

  const handler = createSandboxExecPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () => buildOwnedSandboxServiceRecord(),
    acquireSandboxExecLock: async () => {
      callOrder.push("lock");
      return {
        acquired: true as const,
        token: "lock-123",
      };
    },
    enforceSandboxExecLimits: async () => {
      callOrder.push("limit");
      return {
        allowed: false,
        status: 429,
        code: "sandbox_exec_rate_limited",
        error: "Sandbox exec rate limit exceeded",
        reason: "sandbox_exec_minutely_rate_exceeded",
        retryAfterSeconds: 45,
        limit: {
          name: "sandbox_execs_per_minute",
          value: 20,
          windowSeconds: 60,
        },
      };
    },
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async (sandboxId, token) => {
      releasedLock = { sandboxId, token };
    },
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
    resolveSandboxAiAccess: async () => buildSandboxServiceAiAccess(),
    getSandbox: async () => {
      throw new Error("getSandbox should not be called");
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/exec",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "ls -la" }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 429);
  assert.deepEqual(callOrder, ["lock", "limit"]);
  assert.deepEqual(releasedLock, {
    sandboxId: "sandbox-1",
    token: "lock-123",
  });
  assert.deepEqual(await response.json(), {
    error: "Sandbox exec rate limit exceeded",
    code: "sandbox_exec_rate_limited",
    retryAfterSeconds: 45,
    limit: {
      name: "sandbox_execs_per_minute",
      value: 20,
      windowSeconds: 60,
    },
  });
});

test("POST /api/sandbox/[id]/exec does not acquire a lock for unauthorized requests", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();
  let lockAttempted = false;
  let releaseAttempted = false;

  const handler = createSandboxExecPostHandler({
    getSandboxServiceCredentials: async () => null,
    loadOwnedSandboxRecord: async () => {
      throw new Error("loadOwnedSandboxRecord should not be called");
    },
    acquireSandboxExecLock: async () => {
      lockAttempted = true;
      return {
        acquired: true as const,
        token: "lock-unauthorized",
      };
    },
    enforceSandboxExecLimits: async () => {
      throw new Error("enforceSandboxExecLimits should not be called");
    },
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async () => {
      releaseAttempted = true;
    },
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
    getSandbox: async () => {
      throw new Error("getSandbox should not be called");
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/exec",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "ls -la" }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 401);
  assert.equal(lockAttempted, false);
  assert.equal(releaseAttempted, false);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("POST /api/sandbox/[id]/exec does not acquire a lock when the sandbox is missing", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();
  const callOrder: string[] = [];

  const handler = createSandboxExecPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () => {
      callOrder.push("load");
      return null;
    },
    acquireSandboxExecLock: async () => {
      callOrder.push("lock");
      return {
        acquired: true as const,
        token: "lock-missing",
      };
    },
    enforceSandboxExecLimits: async () => {
      callOrder.push("limit");
      return { allowed: true, status: 200 };
    },
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async () => {
      callOrder.push("release");
    },
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
    getSandbox: async () => {
      throw new Error("getSandbox should not be called");
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/exec",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "ls -la" }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 404);
  assert.deepEqual(callOrder, ["load"]);
  assert.deepEqual(await response.json(), {
    error: "Not found",
    code: "sandbox_not_found",
  });
});

test("POST /api/sandbox/[id]/exec identifies a provider-side missing sandbox", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();
  let releasedLock: { sandboxId: string; token: string } | null = null;
  let listOptions: Record<string, unknown> | undefined;

  const handler = createSandboxExecPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () => buildOwnedSandboxServiceRecord(),
    acquireSandboxExecLock: async () => ({
      acquired: true as const,
      token: "lock-provider-missing",
    }),
    enforceSandboxExecLimits: async () => ({ allowed: true, status: 200 }),
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async (sandboxId, token) => {
      releasedLock = { sandboxId, token };
    },
    resolveSandboxAiAccess: async () => buildSandboxServiceAiAccess(),
    getSandbox: async () => {
      throw providerLookupNotFoundError(
        "Sandbox not found: sandbox-runtime-123"
      );
    },
    listVercelSandboxes: async (_credentials, options) => {
      listOptions = options;
      return [];
    },
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/exec",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "git worktree remove --force /checkout",
        }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Sandbox not found",
    code: "sandbox_not_found",
  });
  assert.deepEqual(releasedLock, {
    sandboxId: "sandbox-1",
    token: "lock-provider-missing",
  });
  assert.deepEqual(listOptions, {
    namePrefix: "sandbox-runtime-123",
    limit: 1,
    sortBy: "name",
    sortOrder: "asc",
  });
});

test("POST /api/sandbox/[id]/exec does not classify a missing provider project as a missing sandbox", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();
  let listAttempted = false;

  const handler = createSandboxExecPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () => buildOwnedSandboxServiceRecord(),
    acquireSandboxExecLock: async () => ({
      acquired: true as const,
      token: "lock-provider-project-missing",
    }),
    enforceSandboxExecLimits: async () => ({ allowed: true, status: 200 }),
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async () => {},
    resolveSandboxAiAccess: async () => buildSandboxServiceAiAccess(),
    getSandbox: async () => {
      throw Object.assign(new Error("Project not found"), { status: 404 });
    },
    listVercelSandboxes: async () => {
      listAttempted = true;
      return [];
    },
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/exec",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "git worktree remove --force /checkout",
        }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Project not found" });
  assert.equal(listAttempted, false);
});

test("POST /api/sandbox/[id]/exec requires provider confirmation before classifying an ambiguous SDK 404", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();
  let listAttempted = false;

  const handler = createSandboxExecPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () => buildOwnedSandboxServiceRecord(),
    acquireSandboxExecLock: async () => ({
      acquired: true as const,
      token: "lock-provider-ambiguous-404",
    }),
    enforceSandboxExecLimits: async () => ({ allowed: true, status: 200 }),
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async () => {},
    resolveSandboxAiAccess: async () => buildSandboxServiceAiAccess(),
    getSandbox: async () => {
      throw providerLookupNotFoundError("Project not found");
    },
    listVercelSandboxes: async () => {
      listAttempted = true;
      throw new Error("Project not found");
    },
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/exec",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "git worktree remove --force /checkout",
        }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Project not found" });
  assert.equal(listAttempted, true);
});

test("POST /api/sandbox/[id]/exec does not acquire a lock when sandbox credentials are forbidden", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();
  const callOrder: string[] = [];

  const handler = createSandboxExecPostHandler({
    getSandboxServiceCredentials: async () =>
      buildSandboxServiceRouteAuth({
        allowPlatformSandbox: false,
      }),
    loadOwnedSandboxRecord: async () => {
      callOrder.push("load");
      return buildOwnedSandboxServiceRecord({
        record: {
          billing_source: "platform",
          billing_project_id: "project-123",
          billing_team_id: null,
          vercel_project_id: "project-123",
          vercel_team_id: null,
        },
      });
    },
    acquireSandboxExecLock: async () => {
      callOrder.push("lock");
      return {
        acquired: true as const,
        token: "lock-forbidden",
      };
    },
    enforceSandboxExecLimits: async () => {
      callOrder.push("limit");
      return { allowed: true, status: 200 };
    },
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async () => {
      callOrder.push("release");
    },
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
    getSandbox: async () => {
      throw new Error("getSandbox should not be called");
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/exec",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "ls -la" }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 403);
  assert.deepEqual(callOrder, ["load"]);
  assert.deepEqual(await response.json(), {
    error:
      "Hosted sandbox compute requires a positive billing balance. Add funds or choose a plan in Settings > Billing.",
  });
});
