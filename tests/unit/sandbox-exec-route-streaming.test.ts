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
    renewSandboxActivityLease: async () => 0,
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
