import assert from "node:assert/strict";
import test from "node:test";

async function loadSandboxTreeRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/sandbox/[id]/tree/route");
}

test("GET /api/sandbox/[id]/tree returns canonical repo-relative paths", async () => {
  const { createSandboxTreeGetHandler } = await loadSandboxTreeRoute();

  let requestedSelect = "";
  let requestedCapability: unknown = "unset";
  let findCommandName = "";
  let findCommandArgs: string[] = [];
  let touchedSandboxId = "";

  const handler = createSandboxTreeGetHandler({
    loadOwnedSandboxRouteContext: async (_request, _sandboxId, options) => {
      requestedSelect = options.select;
      requestedCapability = options.requireCapability;
      return {
        ok: true,
        auth: {} as never,
        record: { sandbox_id: "sandbox-runtime-1" },
        repo: { root_directory: "apps/web" },
        rootDirectory: "apps/web",
        context: {} as never,
        sandbox: {
          runCommand: async (input: { cmd: string; args: string[] }) => {
            findCommandName = input.cmd;
            findCommandArgs = input.args;
            return {
              exitCode: 0,
              stderr: async () => "",
              stdout: async () =>
                "src\td\nsrc/app/page.tsx\tf\nREADME.md\tf\nlinked-config\tl\n",
            };
          },
        },
      } as never;
    },
    touchSandboxLastActive: async (sandboxId: string) => {
      touchedSandboxId = sandboxId;
    },
    renewSandboxActivityLease: async () => 0,
  });

  const response = await handler(
    new Request("http://localhost/api/sandbox/sandbox-1/tree"),
    { params: Promise.resolve({ id: "sandbox-1" }) }
  );

  assert.equal(response.status, 200);
  assert.ok(requestedSelect.includes("repo:repos(root_directory)"));
  assert.equal(requestedCapability, undefined);
  assert.deepEqual(await response.json(), {
    paths: ["linked-config", "README.md", "src/", "src/app/page.tsx"],
  });
  assert.equal(touchedSandboxId, "sandbox-1");
  assert.equal(findCommandName, "find");
  assert.deepEqual(findCommandArgs.slice(0, 4), [
    "apps/web",
    "-mindepth",
    "1",
    "(",
  ]);
  assert.ok(findCommandArgs.includes("node_modules"));
  assert.ok(findCommandArgs.includes(".git"));
});

test("write /api/sandbox/[id]/tree methods require file-write capability", async () => {
  const {
    createSandboxTreePostHandler,
    createSandboxTreePatchHandler,
    createSandboxTreeDeleteHandler,
  } = await loadSandboxTreeRoute();

  const requestedCapabilities: unknown[] = [];
  const context = {
    ok: true,
    auth: {} as never,
    record: { sandbox_id: "sandbox-runtime-1" },
    repo: { root_directory: "apps/web" },
    rootDirectory: "apps/web",
    context: {} as never,
    sandbox: {
      runCommand: async (input: { cmd: string; args: string[] }) => {
        if (input.cmd === "test" && input.args[0] === "-e") {
          return {
            exitCode: input.args[1]?.endsWith("old.ts") ? 0 : 1,
            stderr: async () => "",
            stdout: async () => "",
          };
        }
        return {
          exitCode: 0,
          stderr: async () => "",
          stdout: async () => "",
        };
      },
      writeFiles: async () => {},
    },
  } as never;

  const deps = {
    loadOwnedSandboxRouteContext: async (
      _request: Request,
      _sandboxId: string,
      options: { requireCapability?: unknown }
    ) => {
      requestedCapabilities.push(options.requireCapability);
      return context;
    },
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
  };

  await createSandboxTreePostHandler(deps as never)(
    new Request("http://localhost/api/sandbox/sandbox-1/tree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "file", path: "new.ts" }),
    }),
    { params: Promise.resolve({ id: "sandbox-1" }) }
  );
  await createSandboxTreePatchHandler(deps as never)(
    new Request("http://localhost/api/sandbox/sandbox-1/tree", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moves: [{ fromPath: "old.ts", toPath: "newer.ts" }],
      }),
    }),
    { params: Promise.resolve({ id: "sandbox-1" }) }
  );
  await createSandboxTreeDeleteHandler(deps as never)(
    new Request("http://localhost/api/sandbox/sandbox-1/tree", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "old.ts" }),
    }),
    { params: Promise.resolve({ id: "sandbox-1" }) }
  );

  assert.deepEqual(requestedCapabilities, [
    "tools.write_file",
    "tools.write_file",
    "tools.write_file",
  ]);
});

test("POST /api/sandbox/[id]/tree creates files under the repo root", async () => {
  const { createSandboxTreePostHandler } = await loadSandboxTreeRoute();

  const commands: Array<{ cmd: string; args: string[] }> = [];
  let writes: Array<{ path: string; content: Buffer }> = [];
  let touchedSandboxId = "";

  const handler = createSandboxTreePostHandler({
    loadOwnedSandboxRouteContext: async () =>
      ({
        ok: true,
        auth: {} as never,
        record: { sandbox_id: "sandbox-runtime-1" },
        repo: { root_directory: "apps/web" },
        rootDirectory: "apps/web",
        context: {} as never,
        sandbox: {
          runCommand: async (input: { cmd: string; args: string[] }) => {
            commands.push(input);
            if (input.cmd === "test") {
              return {
                exitCode: 1,
                stderr: async () => "",
                stdout: async () => "",
              };
            }

            return {
              exitCode: 0,
              stderr: async () => "",
              stdout: async () => "",
            };
          },
          writeFiles: async (
            nextWrites: Array<{ path: string; content: Buffer }>
          ) => {
            writes = nextWrites;
          },
        },
      }) as never,
    touchSandboxLastActive: async (sandboxId: string) => {
      touchedSandboxId = sandboxId;
    },
    renewSandboxActivityLease: async () => 0,
  });

  const response = await handler(
    new Request("http://localhost/api/sandbox/sandbox-1/tree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "file",
        path: "src/lib/new-file.ts",
      }),
    }),
    { params: Promise.resolve({ id: "sandbox-1" }) }
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    ok: true,
    path: "src/lib/new-file.ts",
  });
  assert.equal(touchedSandboxId, "sandbox-1");
  assert.deepEqual(commands, [
    { cmd: "test", args: ["-e", "apps/web/src/lib/new-file.ts"] },
    { cmd: "mkdir", args: ["-p", "apps/web/src/lib"] },
  ]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.path, "apps/web/src/lib/new-file.ts");
});

test("PATCH /api/sandbox/[id]/tree moves files without overwriting destinations", async () => {
  const { createSandboxTreePatchHandler } = await loadSandboxTreeRoute();

  const commands: Array<{ cmd: string; args: string[] }> = [];
  let touchedSandboxId = "";

  const handler = createSandboxTreePatchHandler({
    loadOwnedSandboxRouteContext: async () =>
      ({
        ok: true,
        auth: {} as never,
        record: { sandbox_id: "sandbox-runtime-1" },
        repo: { root_directory: "apps/web" },
        rootDirectory: "apps/web",
        context: {} as never,
        sandbox: {
          runCommand: async (input: { cmd: string; args: string[] }) => {
            commands.push(input);
            if (input.cmd === "test" && input.args[0] === "-e") {
              const target = input.args[1];
              return {
                exitCode: target.endsWith("old-name.ts") ? 0 : 1,
                stderr: async () => "",
                stdout: async () => "",
              };
            }

            return {
              exitCode: 0,
              stderr: async () => "",
              stdout: async () => "",
            };
          },
        },
      }) as never,
    touchSandboxLastActive: async (sandboxId: string) => {
      touchedSandboxId = sandboxId;
    },
    renewSandboxActivityLease: async () => 0,
  });

  const response = await handler(
    new Request("http://localhost/api/sandbox/sandbox-1/tree", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moves: [
          {
            fromPath: "src/old-name.ts",
            toPath: "src/new-name.ts",
          },
        ],
      }),
    }),
    { params: Promise.resolve({ id: "sandbox-1" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    moves: [
      {
        fromPath: "src/old-name.ts",
        toPath: "src/new-name.ts",
      },
    ],
  });
  assert.equal(touchedSandboxId, "sandbox-1");
  assert.deepEqual(commands, [
    { cmd: "test", args: ["-e", "apps/web/src/old-name.ts"] },
    { cmd: "test", args: ["-e", "apps/web/src/new-name.ts"] },
    { cmd: "mkdir", args: ["-p", "apps/web/src"] },
    {
      cmd: "mv",
      args: ["apps/web/src/old-name.ts", "apps/web/src/new-name.ts"],
    },
  ]);
});

test("PATCH /api/sandbox/[id]/tree rejects moving a directory into itself", async () => {
  const { createSandboxTreePatchHandler } = await loadSandboxTreeRoute();

  let runCommandCalls = 0;

  const handler = createSandboxTreePatchHandler({
    loadOwnedSandboxRouteContext: async () =>
      ({
        ok: true,
        auth: {} as never,
        record: { sandbox_id: "sandbox-runtime-1" },
        repo: { root_directory: "apps/web" },
        rootDirectory: "apps/web",
        context: {} as never,
        sandbox: {
          runCommand: async () => {
            runCommandCalls += 1;
            return {
              exitCode: 0,
              stderr: async () => "",
              stdout: async () => "",
            };
          },
        },
      }) as never,
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
  });

  const response = await handler(
    new Request("http://localhost/api/sandbox/sandbox-1/tree", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moves: [
          {
            fromPath: "src/components/",
            toPath: "src/components/nested/",
          },
        ],
      }),
    }),
    { params: Promise.resolve({ id: "sandbox-1" }) }
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Cannot move a directory into itself",
  });
  assert.equal(runCommandCalls, 0);
});

test("PATCH /api/sandbox/[id]/tree returns 409 when destination exists", async () => {
  const { createSandboxTreePatchHandler } = await loadSandboxTreeRoute();

  const handler = createSandboxTreePatchHandler({
    loadOwnedSandboxRouteContext: async () =>
      ({
        ok: true,
        auth: {} as never,
        record: { sandbox_id: "sandbox-runtime-1" },
        repo: { root_directory: "apps/web" },
        rootDirectory: "apps/web",
        context: {} as never,
        sandbox: {
          runCommand: async (input: { cmd: string; args: string[] }) => {
            if (input.cmd === "test" && input.args[0] === "-e") {
              return {
                exitCode: 0,
                stderr: async () => "",
                stdout: async () => "",
              };
            }

            return {
              exitCode: 0,
              stderr: async () => "",
              stdout: async () => "",
            };
          },
        },
      }) as never,
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
  });

  const response = await handler(
    new Request("http://localhost/api/sandbox/sandbox-1/tree", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moves: [
          {
            fromPath: "src/a.ts",
            toPath: "src/b.ts",
          },
        ],
      }),
    }),
    { params: Promise.resolve({ id: "sandbox-1" }) }
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Destination already exists",
  });
});

test("POST /api/sandbox/[id]/tree rejects path traversal", async () => {
  const { createSandboxTreePostHandler } = await loadSandboxTreeRoute();

  const handler = createSandboxTreePostHandler({
    loadOwnedSandboxRouteContext: async () =>
      ({
        ok: true,
        auth: {} as never,
        record: { sandbox_id: "sandbox-runtime-1" },
        repo: { root_directory: "apps/web" },
        rootDirectory: "apps/web",
        context: {} as never,
        sandbox: {
          runCommand: async () => ({
            exitCode: 0,
            stderr: async () => "",
            stdout: async () => "",
          }),
        },
      }) as never,
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
  });

  const response = await handler(
    new Request("http://localhost/api/sandbox/sandbox-1/tree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "file",
        path: "../escape.ts",
      }),
    }),
    { params: Promise.resolve({ id: "sandbox-1" }) }
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "path must stay within the repo root",
  });
});

test("DELETE /api/sandbox/[id]/tree removes directories recursively", async () => {
  const { createSandboxTreeDeleteHandler } = await loadSandboxTreeRoute();

  const commands: Array<{ cmd: string; args: string[] }> = [];
  let touchedSandboxId = "";

  const handler = createSandboxTreeDeleteHandler({
    loadOwnedSandboxRouteContext: async () =>
      ({
        ok: true,
        auth: {} as never,
        record: { sandbox_id: "sandbox-runtime-1" },
        repo: { root_directory: "apps/web" },
        rootDirectory: "apps/web",
        context: {} as never,
        sandbox: {
          runCommand: async (input: { cmd: string; args: string[] }) => {
            commands.push(input);
            if (input.cmd === "test") {
              return {
                exitCode: 0,
                stderr: async () => "",
                stdout: async () => "",
              };
            }

            return {
              exitCode: 0,
              stderr: async () => "",
              stdout: async () => "",
            };
          },
        },
      }) as never,
    touchSandboxLastActive: async (sandboxId: string) => {
      touchedSandboxId = sandboxId;
    },
    renewSandboxActivityLease: async () => 0,
  });

  const response = await handler(
    new Request("http://localhost/api/sandbox/sandbox-1/tree", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "src/generated/" }),
    }),
    { params: Promise.resolve({ id: "sandbox-1" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    path: "src/generated/",
  });
  assert.equal(touchedSandboxId, "sandbox-1");
  assert.deepEqual(commands, [
    { cmd: "test", args: ["-e", "apps/web/src/generated"] },
    { cmd: "rm", args: ["-rf", "apps/web/src/generated"] },
  ]);
});
