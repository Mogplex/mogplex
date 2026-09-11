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

type RunCommandInput = {
  cmd: string;
  args?: string[];
  cwd?: string;
  detached?: boolean;
};

async function createHandler(options: {
  rootDirectory?: string | null;
  runCommand: (input: RunCommandInput) => Promise<unknown>;
  onRelease?: () => void;
}) {
  const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();
  return createSandboxExecPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () => ({
      ...buildOwnedSandboxServiceRecord(),
      root_directory: options.rootDirectory ?? null,
    }),
    acquireSandboxExecLock: async () => ({
      acquired: true as const,
      token: "lock-cwd",
    }),
    enforceSandboxExecLimits: async () => ({ allowed: true, status: 200 }),
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async () => {
      options.onRelease?.();
    },
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
    resolveSandboxAiAccess: async () => buildSandboxServiceAiAccess(),
    getSandbox: async () =>
      ({
        runCommand: options.runCommand,
        readFile: async () => {
          throw new Error("missing");
        },
        writeFiles: async () => {},
      }) as never,
  });
}

function execRequest(body: Record<string, unknown>, stream = false) {
  return buildSandboxRouteRequest({
    method: "POST",
    suffix: "/exec",
    init: {
      headers: {
        "Content-Type": "application/json",
        ...(stream ? { Accept: "text/event-stream" } : {}),
      },
      body: JSON.stringify(body),
    },
  });
}

const immediateResult = {
  exitCode: 0,
  stdout: async () => "",
  stderr: async () => "",
};

test("a relative cwd such as '.' resolves under the checkout, never against /", async () => {
  const seen: RunCommandInput[] = [];
  const handler = await createHandler({
    runCommand: async (input) => {
      seen.push(input);
      return immediateResult;
    },
  });

  const response = await handler(
    execRequest({ command: "pwd", cwd: "." }),
    buildSandboxRouteParams()
  );
  assert.equal(response.status, 200);
  assert.equal(seen[0]?.cwd, "/vercel/sandbox");
  assert.equal((await response.json()).cwd, "/vercel/sandbox");

  await handler(
    execRequest({ command: "pwd", cwd: "apps/web" }),
    buildSandboxRouteParams()
  );
  assert.equal(seen[1]?.cwd, "/vercel/sandbox/apps/web");
});

test("the launch subdirectory is the default working directory", async () => {
  const seen: RunCommandInput[] = [];
  const handler = await createHandler({
    rootDirectory: "apps/web",
    runCommand: async (input) => {
      seen.push(input);
      return immediateResult;
    },
  });

  await handler(
    execRequest({ command: "pnpm test" }),
    buildSandboxRouteParams()
  );
  assert.equal(seen[0]?.cwd, "/vercel/sandbox/apps/web");
});

test("a compound command that starts with cd runs as a shell command", async () => {
  const seen: RunCommandInput[] = [];
  const handler = await createHandler({
    runCommand: async (input) => {
      seen.push(input);
      return immediateResult;
    },
  });

  const command = 'cd "$(git rev-parse --show-toplevel)" && pnpm typecheck';
  const response = await handler(
    execRequest({ command }),
    buildSandboxRouteParams()
  );
  assert.equal(response.status, 200);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0]?.args, ["-lc", command]);
  assert.equal(seen[0]?.cwd, "/vercel/sandbox");
});

test("a bare cd still moves the terminal's working directory", async () => {
  const seen: RunCommandInput[] = [];
  const handler = await createHandler({
    runCommand: async (input) => {
      seen.push(input);
      return {
        exitCode: 0,
        stdout: async () => "/vercel/sandbox/apps\n",
        stderr: async () => "",
      };
    },
  });

  const response = await handler(
    execRequest({ command: "cd apps" }),
    buildSandboxRouteParams()
  );
  assert.equal(seen[0]?.args?.[1], "cd 'apps' && pwd");
  assert.equal((await response.json()).cwd, "/vercel/sandbox/apps");
});

test("a provider rejection while starting a streamed command releases the exec lock", async () => {
  let released = 0;
  const handler = await createHandler({
    onRelease: () => {
      released += 1;
    },
    runCommand: async () => {
      throw new APIError(new Response(null, { status: 400 }), {
        message: "Status code 400 is not ok",
        json: {
          error: {
            code: "command_failed",
            message:
              "failed to start process: chdir apps: no such file or directory",
          },
        },
      });
    },
  });

  const response = await handler(
    execRequest({ command: "pnpm test", cwd: "/vercel/sandbox/apps" }, true),
    buildSandboxRouteParams()
  );
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.match(body.error, /Status code 400 is not ok/);
  assert.match(body.error, /chdir apps: no such file or directory/);
  assert.equal(
    released,
    1,
    "lock must be released when the stream never started"
  );
});
