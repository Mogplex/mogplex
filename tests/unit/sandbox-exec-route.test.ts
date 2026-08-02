import assert from "node:assert/strict";
import test from "node:test";
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
  assert.deepEqual(await response.json(), { error: "Not found" });
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
      "Platform sandbox access is not enabled for this account. Relaunch this repo with a personal Vercel billing project to keep using sandbox tools.",
  });
});

test("POST /api/sandbox/[id]/exec injects only OpenAI-compatible AI Gateway env for non-harness commands", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();

  let capturedEnv: Record<string, string> | null = null;

  const handler = createSandboxExecPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () => buildOwnedSandboxServiceRecord(),
    acquireSandboxExecLock: async () => ({
      acquired: true as const,
      token: "lock-123",
    }),
    enforceSandboxExecLimits: async () => ({
      allowed: true,
      status: 200,
    }),
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async () => {},
    touchSandboxLastActive: async () => {},
    resolveSandboxAiAccess: async () =>
      buildSandboxServiceAiAccess({
        aiBillingSource: "user_ai_gateway",
        gatewayApiKey: "gateway-key-123",
      }),
    getSandbox: async () =>
      ({
        runCommand: async (input: { env?: Record<string, string> }) => {
          capturedEnv = input.env ?? null;
          return {
            exitCode: 0,
            stdout: async () => "ok",
            stderr: async () => "",
          };
        },
        readFile: async () => {
          throw new Error("missing");
        },
        writeFiles: async () => {},
      }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/exec",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "echo hello" }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.equal(
    capturedEnv?.["OPENAI_BASE_URL"],
    "https://ai-gateway.vercel.sh/v1"
  );
  assert.equal(capturedEnv?.["OPENAI_API_KEY"], "gateway-key-123");
  assert.equal(capturedEnv?.["CODEX_API_KEY"], "gateway-key-123");
  assert.equal(capturedEnv?.["ANTHROPIC_BASE_URL"], undefined);
  assert.equal(capturedEnv?.["ANTHROPIC_AUTH_TOKEN"], undefined);
  assert.equal(capturedEnv?.["MOGPLEX_AI_BILLING_SOURCE"], "user_ai_gateway");
});

test("POST /api/sandbox/[id]/exec injects Claude-compatible gateway env only for the Claude harness", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();

  let capturedEnv: Record<string, string> | null = null;

  const handler = createSandboxExecPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () => buildOwnedSandboxServiceRecord(),
    acquireSandboxExecLock: async () => ({
      acquired: true as const,
      token: "lock-123",
    }),
    enforceSandboxExecLimits: async () => ({
      allowed: true,
      status: 200,
    }),
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async () => {},
    touchSandboxLastActive: async () => {},
    resolveSandboxAiAccess: async () =>
      buildSandboxServiceAiAccess({
        aiBillingSource: "user_ai_gateway",
        gatewayApiKey: "gateway-key-123",
      }),
    getSandbox: async () =>
      ({
        runCommand: async (input: {
          env?: Record<string, string>;
          cmd?: string;
          args?: string[];
        }) => {
          if (input.cmd === "sh" && input.args?.[1]?.startsWith("which ")) {
            return { exitCode: 0 };
          }
          capturedEnv = input.env ?? null;
          return {
            exitCode: 0,
            stdout: async () => "ok",
            stderr: async () => "",
          };
        },
        readFile: async () => {
          throw new Error("missing");
        },
        writeFiles: async () => {},
      }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/exec",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "claude --version" }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.equal(
    capturedEnv?.["ANTHROPIC_BASE_URL"],
    "https://ai-gateway.vercel.sh"
  );
  assert.equal(capturedEnv?.["ANTHROPIC_AUTH_TOKEN"], "gateway-key-123");
  assert.equal(capturedEnv?.["ANTHROPIC_API_KEY"], "");
  assert.equal(capturedEnv?.["MOGPLEX_AI_BILLING_SOURCE"], "user_ai_gateway");
});

test("POST /api/sandbox/[id]/exec streams SSE when Accept: text/event-stream", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();

  let detachedRequested = false;

  const handler = createSandboxExecPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () => buildOwnedSandboxServiceRecord(),
    acquireSandboxExecLock: async () => ({
      acquired: true as const,
      token: "lock-stream",
    }),
    enforceSandboxExecLimits: async () => ({ allowed: true, status: 200 }),
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async () => {},
    touchSandboxLastActive: async () => {},
    resolveSandboxAiAccess: async () =>
      buildSandboxServiceAiAccess({
        aiBillingSource: "user_ai_gateway",
        gatewayApiKey: "gateway-key-xyz",
      }),
    getSandbox: async () =>
      ({
        runCommand: async (input: { detached?: boolean }) => {
          if (input.detached) {
            detachedRequested = true;
            const logs = async function* logs() {
              yield { stream: "stdout" as const, data: "hello\n" };
              yield { stream: "stdout" as const, data: "world\n" };
            };
            return {
              cmdId: "cmd-xyz",
              logs,
              wait: async () => ({ exitCode: 0 }),
              kill: async () => {},
            };
          }
          return {
            exitCode: 0,
            stdout: async () => "",
            stderr: async () => "",
          };
        },
        readFile: async () => {
          throw new Error("missing");
        },
        writeFiles: async () => {},
      }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/exec",
      init: {
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ command: "echo hello" }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.get("x-exec-cmd-id"), "cmd-xyz");

  const body = await response.text();
  assert.ok(
    detachedRequested,
    "expected runCommand to be called with detached"
  );
  assert.match(body, /"type":"run"/);
  assert.match(body, /"cmdId":"cmd-xyz"/);
  assert.match(body, /"type":"log"/);
  assert.match(body, /hello/);
  assert.match(body, /"type":"done"/);
  assert.match(body, /"exitCode":0/);
});
