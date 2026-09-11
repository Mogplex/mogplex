import assert from "node:assert/strict";
import test from "node:test";

type FakeCommand = { script: string; cwd?: string };

function fakeSandbox(
  respond: (script: string) => {
    exitCode: number;
    stdout: string;
    stderr?: string;
  }
) {
  const commands: FakeCommand[] = [];
  const sandbox = {
    runCommand: async (input: {
      cmd: string;
      args: string[];
      cwd?: string;
    }) => {
      const script = input.args[1] ?? "";
      commands.push({ script, cwd: input.cwd });
      const result = respond(script);
      return {
        stdout: async () => result.stdout,
        stderr: async () => result.stderr ?? "",
        wait: async () => ({ exitCode: result.exitCode }),
      };
    },
  };
  return { sandbox, commands };
}

async function loadRouteModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/sandbox/[id]/changes/route");
}

const STATUS_STDOUT = [
  "MOGPLEX_BRANCH=mogplex/agent-1",
  "MOGPLEX_AHEAD_BEHIND=1\t0",
  "MOGPLEX_STATUS_BEGIN",
  Buffer.from(" M src/app.ts\0").toString("base64"),
  "MOGPLEX_NUMSTAT_BEGIN",
  Buffer.from("2\t1\tsrc/app.ts\0").toString("base64"),
  "MOGPLEX_UNTRACKED_BEGIN",
  "",
].join("\n");

function loadedContext(sandbox: unknown, record: Record<string, unknown> = {}) {
  return async () =>
    ({
      ok: true,
      auth: { userId: "user-1" },
      record: {
        sandbox_id: "vm-1",
        root_directory: "apps/web",
        working_branch: "mogplex/agent-1",
        base_branch: "main",
        vercel_team_id: null,
        vercel_project_id: null,
        repo: { root_directory: null, default_branch: "main" },
        ...record,
      },
      repo: null,
      rootDirectory: "apps/web",
      context: {},
      sandbox,
    }) as never;
}

const params = { params: Promise.resolve({ id: "sandbox-record-1" }) };
const noop = async () => undefined;

test("GET /api/sandbox/[id]/changes returns parsed working-tree changes from the sandbox root", async () => {
  const { createSandboxChangesGetHandler } = await loadRouteModule();
  const { sandbox, commands } = fakeSandbox(() => ({
    exitCode: 0,
    stdout: STATUS_STDOUT,
  }));
  const touched: string[] = [];
  const handler = createSandboxChangesGetHandler({
    loadOwnedSandboxRouteContext: loadedContext(sandbox),
    renewSandboxActivityLease: noop as never,
    touchSandboxLastActive: async (id) => {
      touched.push(id);
    },
  });
  const response = await handler(
    new Request("https://app.test/api/sandbox/sandbox-record-1/changes"),
    params
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    branch: "mogplex/agent-1",
    baseBranch: "main",
    ahead: 1,
    behind: 0,
    files: [
      { path: "src/app.ts", status: "modified", additions: 2, deletions: 1 },
    ],
  });
  assert.equal(commands[0]?.cwd, "/vercel/sandbox/apps/web");
  assert.match(commands[0]?.script ?? "", /git status --porcelain=v1/);
  assert.deepEqual(touched, ["sandbox-record-1"]);
});

test("GET /api/sandbox/[id]/changes?path= returns one file's diff and rejects unsafe paths", async () => {
  const { createSandboxChangesGetHandler } = await loadRouteModule();
  const { sandbox, commands } = fakeSandbox(() => ({
    exitCode: 0,
    stdout: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-a\n+b\n",
  }));
  const handler = createSandboxChangesGetHandler({
    loadOwnedSandboxRouteContext: loadedContext(sandbox),
    renewSandboxActivityLease: noop as never,
    touchSandboxLastActive: noop as never,
  });
  const response = await handler(
    new Request(
      "https://app.test/api/sandbox/sandbox-record-1/changes?path=src%2Fapp.ts"
    ),
    params
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.path, "src/app.ts");
  assert.match(payload.diff, /\+b/);
  assert.match(commands[0]?.script ?? "", /'src\/app\.ts'/);

  const rejected = await handler(
    new Request(
      "https://app.test/api/sandbox/sandbox-record-1/changes?path=..%2Fsecret"
    ),
    params
  );
  assert.equal(rejected.status, 400);
  assert.equal(commands.length, 1);
});

test("POST revert restores the listed files and returns the fresh status", async () => {
  const { createSandboxChangesPostHandler } = await loadRouteModule();
  const { sandbox, commands } = fakeSandbox((script) => ({
    exitCode: 0,
    stdout: script.includes("git status")
      ? "MOGPLEX_BRANCH=mogplex/agent-1\nMOGPLEX_STATUS_BEGIN\nMOGPLEX_NUMSTAT_BEGIN\nMOGPLEX_UNTRACKED_BEGIN\n"
      : "",
  }));
  const handler = createSandboxChangesPostHandler({
    loadOwnedSandboxRouteContext: loadedContext(sandbox),
    renewSandboxActivityLease: noop as never,
    touchSandboxLastActive: noop as never,
    runExec: async () => {
      throw new Error("revert must not go through exec");
    },
  });
  const response = await handler(
    new Request("https://app.test/api/sandbox/sandbox-record-1/changes", {
      method: "POST",
      body: JSON.stringify({ action: "revert", paths: ["src/app.ts"] }),
    }),
    params
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.reverted, ["src/app.ts"]);
  assert.deepEqual(payload.changes.files, []);
  assert.match(commands[0]?.script ?? "", /git checkout HEAD -- /);
});

test("POST commit runs through the exec route and reports push and PR results", async () => {
  const { createSandboxChangesPostHandler } = await loadRouteModule();
  const { sandbox } = fakeSandbox(() => ({
    exitCode: 0,
    stdout: STATUS_STDOUT,
  }));
  const execCalls: Array<{ id: string; command: string }> = [];
  const handler = createSandboxChangesPostHandler({
    loadOwnedSandboxRouteContext: loadedContext(sandbox),
    renewSandboxActivityLease: noop as never,
    touchSandboxLastActive: noop as never,
    runExec: async (_request, id, command) => {
      execCalls.push({ id, command });
      return {
        exitCode: 0,
        stdout:
          "MOGPLEX_COMMITTED=true\nMOGPLEX_SHA=abc\nMOGPLEX_PUSHED=true\nMOGPLEX_PULL_REQUEST_URL=https://github.com/o/r/pull/1\n",
        stderr: "",
      };
    },
  });
  const response = await handler(
    new Request("https://app.test/api/sandbox/sandbox-record-1/changes", {
      method: "POST",
      body: JSON.stringify({
        action: "commit",
        message: "Fix header",
        push: true,
        openPullRequest: true,
      }),
    }),
    params
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.committed, true);
  assert.equal(payload.pushed, true);
  assert.equal(payload.pullRequestUrl, "https://github.com/o/r/pull/1");
  assert.equal(execCalls[0]?.id, "sandbox-record-1");
  assert.match(execCalls[0]?.command ?? "", /gh pr create/);
  assert.match(execCalls[0]?.command ?? "", /'main'/);
});

test("POST rejects malformed actions before touching the sandbox", async () => {
  const { createSandboxChangesPostHandler } = await loadRouteModule();
  let loaded = 0;
  const handler = createSandboxChangesPostHandler({
    loadOwnedSandboxRouteContext: (async () => {
      loaded += 1;
      throw new Error("unreachable");
    }) as never,
  });
  for (const body of [
    { action: "revert", paths: [] },
    { action: "revert", paths: ["../x"] },
    { action: "commit", message: "   " },
    { action: "nuke" },
  ]) {
    const response = await handler(
      new Request("https://app.test/api/sandbox/sandbox-record-1/changes", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      params
    );
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(loaded, 0);
});
