import assert from "node:assert/strict";
import test from "node:test";
import { SandboxBillingAdmissionError } from "@/lib/billing/sandbox-usage";
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

test("POST /api/sandbox/[id]/exec injects only OpenAI-compatible AI Gateway env for non-harness commands", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();

  let capturedEnv: Record<string, string> | null = null;
  let hasBillingOnResume = false;

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
    renewSandboxActivityLease: async () => 0,
    resolveSandboxAiAccess: async () =>
      buildSandboxServiceAiAccess({
        aiBillingSource: "user_ai_gateway",
        gatewayApiKey: "gateway-key-123",
      }),
    getSandbox: async (_sandboxId, _credentials, options) => {
      hasBillingOnResume = typeof options?.onResume === "function";
      return {
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
      } as never;
    },
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
  assert.equal(hasBillingOnResume, true);
});

test("POST /api/sandbox/[id]/exec returns 402 when resume billing admission is denied", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();
  const handler = createSandboxExecPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () => buildOwnedSandboxServiceRecord(),
    acquireSandboxExecLock: async () => ({
      acquired: true as const,
      token: "lock-billing",
    }),
    enforceSandboxExecLimits: async () => ({ allowed: true, status: 200 }),
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async () => {},
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
    resolveSandboxAiAccess: async () => buildSandboxServiceAiAccess(),
    getSandbox: async () => {
      throw new SandboxBillingAdmissionError(
        "Hosted sandbox compute requires a positive billing balance",
        "no_billing_account"
      );
    },
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

  assert.equal(response.status, 402);
  assert.deepEqual(await response.json(), {
    error: "Hosted sandbox compute requires a positive billing balance",
  });
});

test("POST /api/sandbox/[id]/exec refreshes repo-scoped GitHub auth before git commands", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();
  let capturedEnv: Record<string, string> | null = null;
  let syncedToken: string | null = null;

  const handler = createSandboxExecPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () =>
      buildOwnedSandboxServiceRecord({
        repo: {
          full_name: "acme/repo",
          root_directory: null,
          sandbox_env_vars: null,
          env_sync_mode: "sandbox-only",
          vercel_project_id: null,
          vercel_team_id: null,
          github_installation_id: 42,
        },
      }),
    acquireSandboxExecLock: async () => ({
      acquired: true as const,
      token: "lock-github",
    }),
    enforceSandboxExecLimits: async () => ({ allowed: true, status: 200 }),
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async () => {},
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
    resolveSandboxAiAccess: async () => buildSandboxServiceAiAccess(),
    getGithubAccessTokenForRepo: async () => "fresh-github-token",
    syncTerminalRuntimeAuth: async (_sandbox, options) => {
      syncedToken = options.githubToken ?? null;
      return { ok: true, logs: "" };
    },
    getSandbox: async () =>
      ({
        runCommand: async (input: { env?: Record<string, string> }) => {
          capturedEnv = input.env ?? null;
          return {
            exitCode: 0,
            stdout: async () => "pushed",
            stderr: async () => "",
          };
        },
      }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/exec",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "git push origin feature" }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.equal((await response.clone().json()).exitCode, 0);
  assert.equal(syncedToken, "fresh-github-token");
  assert.equal(capturedEnv?.["GITHUB_TOKEN"], "fresh-github-token");
  assert.equal(capturedEnv?.["GH_TOKEN"], "fresh-github-token");
});

test("POST /api/sandbox/[id]/exec skips GitHub auth refresh for local git commands", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();
  let tokenRequested = false;

  const handler = createSandboxExecPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () =>
      buildOwnedSandboxServiceRecord({
        repo: {
          full_name: "acme/repo",
          root_directory: null,
          sandbox_env_vars: null,
          env_sync_mode: "sandbox-only",
          vercel_project_id: null,
          vercel_team_id: null,
          github_installation_id: 42,
        },
      }),
    acquireSandboxExecLock: async () => ({
      acquired: true as const,
      token: "lock-local-git",
    }),
    enforceSandboxExecLimits: async () => ({ allowed: true, status: 200 }),
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async () => {},
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
    resolveSandboxAiAccess: async () => buildSandboxServiceAiAccess(),
    getGithubAccessTokenForRepo: async () => {
      tokenRequested = true;
      return "unused-token";
    },
    getSandbox: async () =>
      ({
        runCommand: async () => ({
          exitCode: 0,
          stdout: async () => "clean",
          stderr: async () => "",
        }),
      }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/exec",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "git status --short" }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.equal(tokenRequested, false);
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
    renewSandboxActivityLease: async () => 0,
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
