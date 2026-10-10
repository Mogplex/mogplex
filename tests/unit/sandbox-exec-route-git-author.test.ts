import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
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

const execFile = promisify(execFileCallback);

test("agent commits use the linked GitHub identity despite invented git -c authors", async () => {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();
  const checkout = await mkdtemp(path.join(tmpdir(), "mogplex-git-author-"));
  try {
    await execFile("git", ["init", "--quiet", checkout]);
    const handler = createSandboxExecPostHandler({
      getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
      loadOwnedSandboxRecord: async () => buildOwnedSandboxServiceRecord(),
      resolveSandboxGitAuthor: async () => ({
        name: "GitHub User",
        email: "123+user@users.noreply.github.com",
      }),
      acquireSandboxExecLock: async () => ({ acquired: true, token: "lock" }),
      enforceSandboxExecLimits: async () => ({ allowed: true, status: 200 }),
      recordLimitDecision: async () => {},
      releaseSandboxExecLock: async () => {},
      touchSandboxLastActive: async () => {},
      renewSandboxActivityLease: async () => 0,
      resolveSandboxAiAccess: async () => buildSandboxServiceAiAccess(),
      getSandbox: async () =>
        ({
          runCommand: async (input: {
            cmd: string;
            args?: string[];
            env?: Record<string, string>;
          }) => {
            const { stdout, stderr } = await execFile(
              input.cmd,
              input.args ?? [],
              {
                cwd: checkout,
                env: {
                  NODE_ENV: "test",
                  PATH: process.env.PATH,
                  GIT_CONFIG_NOSYSTEM: "1",
                  GIT_CONFIG_GLOBAL: "/dev/null",
                  ...input.env,
                },
              }
            );
            return {
              exitCode: 0,
              stdout: async () => stdout,
              stderr: async () => stderr,
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
          body: JSON.stringify({
            command:
              "git -c user.name='Invented Agent' -c user.email='agent@mogplex.local' -c commit.gpgsign=false commit --allow-empty -m regression && git log -1 --format='%an|%ae|%cn|%ce'",
          }),
        },
      }),
      buildSandboxRouteParams()
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.exitCode, 0);
    assert.match(
      result.stdout,
      /GitHub User\|123\+user@users\.noreply\.github\.com\|GitHub User\|123\+user@users\.noreply\.github\.com/
    );
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
});
