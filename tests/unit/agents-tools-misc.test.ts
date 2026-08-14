import assert from "node:assert/strict";
import test from "node:test";

import {
  loadRestToolModule,
  loadToolsModule,
  withEnv,
  withPatchedFetch,
} from "./helpers/agents-tools-fixtures";

test("buildStaticTools exposes inputSchema for every built-in tool", async () => {
  const { buildStaticTools } = await loadToolsModule();
  const tools = buildStaticTools();

  assert.equal("web_fetch" in tools, true);

  for (const [name, builtTool] of Object.entries(tools)) {
    assert.ok(
      "inputSchema" in builtTool && builtTool.inputSchema,
      `${name} is missing inputSchema`
    );
  }
});

test("buildStaticTools keeps sandbox startup repository server-owned", async () => {
  const { buildStaticTools } = await loadToolsModule();
  const withoutRepository = buildStaticTools(undefined, "user-123");
  assert.equal("start_sandbox" in withoutRepository, false);

  const withRepository = buildStaticTools(
    undefined,
    "user-123",
    null,
    undefined,
    "repo-server-owned"
  ) as Record<string, unknown>;
  const startSandbox = withRepository.start_sandbox as {
    inputSchema: { shape: Record<string, unknown> };
  };
  assert.deepEqual(Object.keys(startSandbox.inputSchema.shape), []);
});

test("webFetch rejects localhost targets before fetching", async () => {
  const { webFetch } = await loadToolsModule();
  const tool = webFetch as unknown as {
    execute: (input: { url: string }) => Promise<unknown>;
  };

  await assert.rejects(
    () => tool.execute({ url: "http://localhost:3000" }),
    /url must target a public host/
  );
});

test("webFetch schema does not advertise selector extraction", async () => {
  const { webFetch } = await loadToolsModule();
  const tool = webFetch as unknown as {
    inputSchema: { shape: Record<string, unknown> };
  };

  assert.deepEqual(Object.keys(tool.inputSchema.shape), ["url"]);
});

test("createRestApiTool exposes inputSchema for provider validation", async () => {
  const { createRestApiTool } = await loadRestToolModule();
  const tool = createRestApiTool(
    {
      id: "conn-1",
      user_id: "user-1",
      name: "Acme",
      type: "rest_api",
      base_url: "https://api.example.com",
      auth_type: "bearer",
      auth_header: null,
      mcp_transport: null,
      mcp_url: null,
      description: "Test API",
      is_enabled: true,
      health_status: "healthy",
      scope: "global",
      repo_id: null,
      oauth_client_id: null,
      oauth_authorize_url: null,
      oauth_token_url: null,
      oauth_scopes: null,
      oauth_authorized_at: null,
      oauth_token_expires_at: null,
      source_preset: null,
      last_tested_at: null,
      last_test_error: null,
      last_test_http_status: null,
      last_test_tool_count: null,
      created_at: "2026-04-12T00:00:00.000Z",
      updated_at: "2026-04-12T00:00:00.000Z",
    },
    "secret-token"
  );

  assert.ok("inputSchema" in tool && tool.inputSchema);
});

test("terminal_exec reports a missing exitCode as null rather than 0", async () => {
  // A malformed sandbox response used to be asserted into a number, so the
  // model read a missing exit code as a clean exit. Keep it as "unknown".
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedFetch(
      async () =>
        Response.json(
          { stdout: "partial output" },
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
      async () => {
        const { createTerminalExec } = await loadToolsModule();
        const tool = createTerminalExec("sandbox-1", "user-123") as unknown as {
          execute: (input: { command: string }) => Promise<unknown>;
        };

        assert.deepEqual(await tool.execute({ command: "pnpm build" }), {
          exitCode: null,
          stdout: "partial output",
          stderr: "",
          command: "pnpm build",
          sandboxId: "sandbox-1",
          sandboxResolution: "selected",
        });
      }
    );
  });
});

test("terminal_exec passes a zero exit code through untouched", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedFetch(
      async () =>
        Response.json(
          { exitCode: 0, stdout: "ok", stderr: "warn" },
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
      async () => {
        const { createTerminalExec } = await loadToolsModule();
        const tool = createTerminalExec("sandbox-1", "user-123") as unknown as {
          execute: (input: { command: string }) => Promise<unknown>;
        };

        assert.deepEqual(await tool.execute({ command: "true" }), {
          exitCode: 0,
          stdout: "ok",
          stderr: "warn",
          command: "true",
          sandboxId: "sandbox-1",
          sandboxResolution: "selected",
        });
      }
    );
  });
});

test("terminal_exec preserves the resolved sandbox identity on command failure", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedFetch(
      async () => Response.json({ error: "command rejected" }, { status: 500 }),
      async () => {
        const { createTerminalExec } = await loadToolsModule();
        const tool = createTerminalExec("sandbox-1", "user-123") as unknown as {
          execute: (input: { command: string }) => Promise<unknown>;
        };

        assert.deepEqual(await tool.execute({ command: "false" }), {
          error: "command rejected",
          command: "false",
          sandboxId: "sandbox-1",
          sandboxResolution: "selected",
        });
      }
    );
  });
});

test("write_file uses its server-selected sandbox without a model sandbox id", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    let capturedUrl = "";
    await withPatchedFetch(
      async (input) => {
        capturedUrl = String(input);
        return Response.json({ ok: true });
      },
      async () => {
        const { createWriteFile } = await loadToolsModule();
        const tool = createWriteFile(
          "user-123",
          "sandbox-selected"
        ) as unknown as {
          inputSchema: { shape: Record<string, unknown> };
          execute: (input: {
            path: string;
            content: string;
          }) => Promise<unknown>;
        };

        assert.deepEqual(Object.keys(tool.inputSchema.shape), [
          "path",
          "content",
        ]);
        assert.deepEqual(
          await tool.execute({ path: "src/a.ts", content: "export {};" }),
          {
            ok: true,
            path: "src/a.ts",
            sandboxId: "sandbox-selected",
          }
        );
        assert.match(capturedUrl, /\/sandbox-selected\/files$/);
      }
    );
  });
});
