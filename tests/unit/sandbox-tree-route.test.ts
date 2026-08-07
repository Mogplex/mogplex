import assert from "node:assert/strict";
import test from "node:test";
import {
  loadSandboxTreeRoute,
  buildBaseSandboxContext,
  buildTreeRouteParams,
  buildTreeRouteRequest,
  buildDefaultDeps,
} from "./helpers/sandbox-tree-route-fixtures";

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
      return buildBaseSandboxContext({
        runCommand: async (input) => {
          findCommandName = input.cmd;
          findCommandArgs = input.args;
          return {
            exitCode: 0,
            stderr: async () => "",
            stdout: async () =>
              "src\td\nsrc/app/page.tsx\tf\nREADME.md\tf\nlinked-config\tl\n",
          };
        },
      });
    },
    touchSandboxLastActive: async (sandboxId: string) => {
      touchedSandboxId = sandboxId;
    },
    renewSandboxActivityLease: async () => 0,
  });

  const response = await handler(
    new Request("http://localhost/api/sandbox/sandbox-1/tree"),
    buildTreeRouteParams()
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
  const context = buildBaseSandboxContext({
    runCommand: async (input) => {
      if (input.cmd === "test" && input.args[0] === "-e") {
        return {
          exitCode: input.args[1]?.endsWith("old.ts") ? 0 : 1,
          stderr: async () => "",
          stdout: async () => "",
        };
      }
      return { exitCode: 0, stderr: async () => "", stdout: async () => "" };
    },
  });

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
    buildTreeRouteRequest("POST", { kind: "file", path: "new.ts" }),
    buildTreeRouteParams()
  );
  await createSandboxTreePatchHandler(deps as never)(
    buildTreeRouteRequest("PATCH", {
      moves: [{ fromPath: "old.ts", toPath: "newer.ts" }],
    }),
    buildTreeRouteParams()
  );
  await createSandboxTreeDeleteHandler(deps as never)(
    buildTreeRouteRequest("DELETE", { path: "old.ts" }),
    buildTreeRouteParams()
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
      buildBaseSandboxContext({
        runCommand: async (input) => {
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
        writeFiles: async (nextWrites) => {
          writes = nextWrites;
        },
      }),
    touchSandboxLastActive: async (sandboxId: string) => {
      touchedSandboxId = sandboxId;
    },
    renewSandboxActivityLease: async () => 0,
  });

  const response = await handler(
    buildTreeRouteRequest("POST", {
      kind: "file",
      path: "src/lib/new-file.ts",
    }),
    buildTreeRouteParams()
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
      buildBaseSandboxContext({
        runCommand: async (input) => {
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
      }),
    touchSandboxLastActive: async (sandboxId: string) => {
      touchedSandboxId = sandboxId;
    },
    renewSandboxActivityLease: async () => 0,
  });

  const response = await handler(
    buildTreeRouteRequest("PATCH", {
      moves: [{ fromPath: "src/old-name.ts", toPath: "src/new-name.ts" }],
    }),
    buildTreeRouteParams()
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    moves: [{ fromPath: "src/old-name.ts", toPath: "src/new-name.ts" }],
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
    ...buildDefaultDeps(
      buildBaseSandboxContext({
        runCommand: async () => {
          runCommandCalls += 1;
          return {
            exitCode: 0,
            stderr: async () => "",
            stdout: async () => "",
          };
        },
      })
    ),
  });

  const response = await handler(
    buildTreeRouteRequest("PATCH", {
      moves: [
        { fromPath: "src/components/", toPath: "src/components/nested/" },
      ],
    }),
    buildTreeRouteParams()
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
    ...buildDefaultDeps(
      buildBaseSandboxContext({
        runCommand: async (input) => {
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
      })
    ),
  });

  const response = await handler(
    buildTreeRouteRequest("PATCH", {
      moves: [{ fromPath: "src/a.ts", toPath: "src/b.ts" }],
    }),
    buildTreeRouteParams()
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Destination already exists",
  });
});

test("POST /api/sandbox/[id]/tree rejects path traversal", async () => {
  const { createSandboxTreePostHandler } = await loadSandboxTreeRoute();

  const handler = createSandboxTreePostHandler(buildDefaultDeps());

  const response = await handler(
    buildTreeRouteRequest("POST", { kind: "file", path: "../escape.ts" }),
    buildTreeRouteParams()
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
      buildBaseSandboxContext({
        runCommand: async (input) => {
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
      }),
    touchSandboxLastActive: async (sandboxId: string) => {
      touchedSandboxId = sandboxId;
    },
    renewSandboxActivityLease: async () => 0,
  });

  const response = await handler(
    buildTreeRouteRequest("DELETE", { path: "src/generated/" }),
    buildTreeRouteParams()
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, path: "src/generated/" });
  assert.equal(touchedSandboxId, "sandbox-1");
  assert.deepEqual(commands, [
    { cmd: "test", args: ["-e", "apps/web/src/generated"] },
    { cmd: "rm", args: ["-rf", "apps/web/src/generated"] },
  ]);
});
