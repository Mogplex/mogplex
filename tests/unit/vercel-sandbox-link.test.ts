import assert from "node:assert/strict";
import test from "node:test";

async function loadVercelSandboxHelpers() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/vercel/env-vars");
}

function createMockSandbox(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  const commands: string[] = [];

  return {
    files,
    commands,
    sandbox: {
      async readFileToBuffer({ path }: { path: string }) {
        if (!files.has(path)) {
          throw new Error(`ENOENT: ${path}`);
        }
        return Buffer.from(files.get(path)!, "utf-8");
      },
      async writeFiles(entries: Array<{ path: string; content: Buffer }>) {
        for (const entry of entries) {
          files.set(entry.path, entry.content.toString("utf-8"));
        }
      },
      async runCommand({ args }: { cmd: string; args?: string[] }) {
        const command = args?.[1] ?? "";
        commands.push(command);

        if (command.startsWith("rm -f ")) {
          const matches = Array.from(command.matchAll(/'([^']+)'/g));
          for (const match of matches) {
            files.delete(match[1]);
          }
        }

        return {
          exitCode: 0,
          stdout: async () => "",
          stderr: async () => "",
        };
      },
    },
  };
}

test("prepareSandboxVercelLink does not materialize disabled Vercel env sync", async () => {
  const { cleanupPreparedSandboxVercelLink, prepareSandboxVercelLink } =
    await loadVercelSandboxHelpers();
  const mock = createMockSandbox({
    "apps/web/README.md": "keep me",
  });

  const prepared = await prepareSandboxVercelLink(mock.sandbox as never, {
    rootDirectory: "apps/web",
    envSyncMode: "vercel-project",
    envVars: {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "super-secret",
    },
    linkedProject: {
      projectId: "prj_123",
      teamId: "team_456",
    },
  });

  assert.equal(prepared.applied, false);
  assert.equal(prepared.warning, null);
  assert.deepEqual(prepared.generatedFiles, []);

  const cleanup = await cleanupPreparedSandboxVercelLink(
    mock.sandbox as never,
    {
      rootDirectory: "apps/web",
    }
  );

  assert.deepEqual(cleanup.removedFiles, prepared.generatedFiles);
  assert.equal(mock.files.has("apps/web/.env.local"), false);
  assert.equal(mock.files.has("apps/web/.vercel/.env.preview.local"), false);
  assert.equal(mock.files.has("apps/web/.vercel/project.json"), false);
  assert.equal(
    mock.files.has("apps/web/.mogplex/vercel-link-manifest.json"),
    false
  );
  assert.equal(mock.files.get("apps/web/README.md"), "keep me");
  assert.equal(mock.commands.length, 0);
});

test("disabled Vercel env sync leaves user-managed files untouched", async () => {
  const { prepareSandboxVercelLink } = await loadVercelSandboxHelpers();
  const mock = createMockSandbox({
    ".env.local": "USER_DEFINED=1\n",
    ".vercel/project.json": JSON.stringify({
      projectId: "prj_other",
      orgId: "team_other",
    }),
  });

  const prepared = await prepareSandboxVercelLink(mock.sandbox as never, {
    envSyncMode: "vercel-project",
    envVars: {
      API_TOKEN: "token-123",
    },
    linkedProject: {
      projectId: "prj_expected",
      teamId: "team_expected",
    },
  });

  assert.equal(prepared.applied, false);
  assert.equal(prepared.warning, null);
  assert.equal(mock.files.get(".env.local"), "USER_DEFINED=1\n");
  assert.equal(
    mock.files.get(".vercel/project.json"),
    JSON.stringify({ projectId: "prj_other", orgId: "team_other" })
  );
  assert.equal(mock.files.has(".vercel/.env.preview.local"), false);
  assert.equal(mock.files.has(".mogplex/vercel-link-manifest.json"), false);
});

test("disabled Vercel env sync performs no sandbox writes", async () => {
  const { prepareSandboxVercelLink } = await loadVercelSandboxHelpers();

  const sandbox = {
    async readFileToBuffer() {
      throw new Error("ENOENT");
    },
    async writeFiles() {
      throw new Error("write failed");
    },
    async runCommand() {
      return {
        exitCode: 0,
        stdout: async () => "",
        stderr: async () => "",
      };
    },
  };

  const prepared = await prepareSandboxVercelLink(sandbox as never, {
    envSyncMode: "vercel-project",
    envVars: { API_TOKEN: "token-123" },
    linkedProject: { projectId: "prj_123", teamId: null },
  });

  assert.equal(prepared.applied, false);
  assert.equal(prepared.warning, null);
  assert.deepEqual(prepared.generatedFiles, []);
});
