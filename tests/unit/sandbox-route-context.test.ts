import assert from "node:assert/strict";
import test from "node:test";
import { buildSandboxRouteRequest } from "./sandbox-record-route-test-harness";
import { buildSandboxServiceRouteAuth } from "./sandbox-service-route-test-harness";

async function loadSandboxRouteContext() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/route-context");
}

function buildSandboxRouteContextRequest() {
  return buildSandboxRouteRequest({ id: "sb-1" });
}

function buildSandboxRouteContextAuth(
  overrides: Partial<ReturnType<typeof buildSandboxServiceRouteAuth>> = {}
) {
  return buildSandboxServiceRouteAuth({
    vercelToken: "platform-token",
    vercelProjectId: "platform-project",
    ...overrides,
  });
}

function buildSandboxRouteContextRecord(
  overrides: {
    sandbox_id?: string;
    root_directory?: string | null;
    repo?:
      | { root_directory: string | null }
      | Array<{ root_directory: string | null }>
      | null;
  } = {}
) {
  return {
    sandbox_id: "sandbox-live",
    repo: null,
    ...overrides,
  };
}

test("loadOwnedSandboxRouteRecord returns 401 when auth is missing", async () => {
  const { loadOwnedSandboxRouteRecord } = await loadSandboxRouteContext();

  const result = await loadOwnedSandboxRouteRecord(
    buildSandboxRouteContextRequest(),
    "sb-1",
    { select: "sandbox_id" },
    {
      getSandboxServiceCredentials: async () => null,
    }
  );

  assert.deepEqual(result, {
    ok: false,
    status: 401,
    error: "Unauthorized",
  });
});

test("loadOwnedSandboxRouteRecord returns 403 when requireCapability denies the active scope", async () => {
  const { loadOwnedSandboxRouteRecord } = await loadSandboxRouteContext();
  const { SandboxCapabilityDeniedError } =
    await import("../../lib/sandbox/get-user-credentials");

  let loadRecordCalls = 0;
  const result = await loadOwnedSandboxRouteRecord(
    buildSandboxRouteContextRequest(),
    "sb-1",
    { select: "sandbox_id", requireCapability: "tools.bash" },
    {
      getSandboxServiceCredentials: async (_request, options) => {
        if (options?.requireCapability === "tools.bash") {
          throw new SandboxCapabilityDeniedError("tools.bash");
        }
        throw new Error("expected requireCapability to be forwarded");
      },
      loadOwnedSandboxRecord: async () => {
        loadRecordCalls += 1;
        return null;
      },
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 403);
    assert.match(result.error, /tools\.bash/);
  }
  assert.equal(
    loadRecordCalls,
    0,
    "must not touch the sandboxes table when capability is denied"
  );
});

test("loadOwnedSandboxRouteContext returns 404 when the sandbox is not owned by the caller", async () => {
  const { loadOwnedSandboxRouteContext } = await loadSandboxRouteContext();

  const result = await loadOwnedSandboxRouteContext(
    buildSandboxRouteContextRequest(),
    "sb-1",
    { select: "sandbox_id" },
    {
      getSandboxServiceCredentials: async () => buildSandboxRouteContextAuth(),
      loadOwnedSandboxRecord: async () => null,
    }
  );

  assert.deepEqual(result, {
    ok: false,
    status: 404,
    error: "Not found",
  });
});

test("loadOwnedSandboxRouteContext returns context errors as route failures", async () => {
  const { loadOwnedSandboxRouteContext } = await loadSandboxRouteContext();

  const result = await loadOwnedSandboxRouteContext(
    buildSandboxRouteContextRequest(),
    "sb-1",
    { select: "sandbox_id, repo:repos(root_directory)" },
    {
      getSandboxServiceCredentials: async () => buildSandboxRouteContextAuth(),
      loadOwnedSandboxRecord: async () =>
        buildSandboxRouteContextRecord({
          repo: [{ root_directory: "apps/web" }],
        }),
      resolveSandboxRecordContext: async () => ({
        ok: false,
        error:
          "Sandbox is missing its stored Vercel project for user-owned billing.",
        status: 400,
      }),
    }
  );

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error:
      "Sandbox is missing its stored Vercel project for user-owned billing.",
  });
});

test("loadOwnedSandboxRouteContext normalizes the repo relation and hydrates the sandbox client", async () => {
  const { loadOwnedSandboxRouteContext } = await loadSandboxRouteContext();
  const resolveCalls: Array<boolean | undefined> = [];
  const sandboxCalls: Array<{
    sandboxId: string;
    projectId: string;
    teamId: string | null | undefined;
  }> = [];

  const result = await loadOwnedSandboxRouteContext(
    buildSandboxRouteContextRequest(),
    "sb-1",
    { select: "sandbox_id, repo:repos(root_directory)", includeAi: true },
    {
      getSandboxServiceCredentials: async () => buildSandboxRouteContextAuth(),
      loadOwnedSandboxRecord: async () =>
        buildSandboxRouteContextRecord({
          repo: [{ root_directory: "apps/web" }],
        }),
      resolveSandboxRecordContext: async (input) => {
        resolveCalls.push(input.includeAi);
        return {
          ok: true,
          context: {
            ownership: {
              source: "record",
              billingSource: "platform",
              credentialSource: "platform",
              projectId: "project-123",
              teamId: null,
            },
            credentials: {
              vercelToken: "resolved-token",
              vercelTeamId: null,
              vercelProjectId: "project-123",
            },
          },
        };
      },
      getSandbox: async (sandboxId, options) => {
        sandboxCalls.push({
          sandboxId,
          projectId: options.vercelProjectId,
          teamId: options.vercelTeamId,
        });
        return { status: "running" } as never;
      },
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.rootDirectory, "apps/web");
  assert.deepEqual(result.repo, { root_directory: "apps/web" });
  assert.equal(result.sandbox?.status, "running");
  assert.deepEqual(resolveCalls, [true]);
  assert.deepEqual(sandboxCalls, [
    {
      sandboxId: "sandbox-live",
      projectId: "project-123",
      teamId: null,
    },
  ]);
});

test("loadOwnedSandboxRouteContext prefers the sandbox's own root_directory over the repo default", async () => {
  const { loadOwnedSandboxRouteContext } = await loadSandboxRouteContext();

  const result = await loadOwnedSandboxRouteContext(
    buildSandboxRouteContextRequest(),
    "sb-1",
    { select: "sandbox_id, root_directory, repo:repos(root_directory)" },
    {
      getSandboxServiceCredentials: async () => buildSandboxRouteContextAuth(),
      loadOwnedSandboxRecord: async () =>
        buildSandboxRouteContextRecord({
          // Sandbox launched at apps/admin even though repo default is
          // apps/web — files/exec/terminal must follow the sandbox.
          root_directory: "apps/admin",
          repo: [{ root_directory: "apps/web" }],
        }),
      resolveSandboxRecordContext: async () => ({
        ok: true,
        context: {
          ownership: {
            source: "record",
            billingSource: "platform",
            credentialSource: "platform",
            projectId: "project-123",
            teamId: null,
          },
          credentials: {
            vercelToken: "resolved-token",
            vercelTeamId: null,
            vercelProjectId: "project-123",
          },
        },
      }),
      getSandbox: async () => ({ status: "running" }) as never,
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rootDirectory, "apps/admin");
});

test("loadOwnedSandboxRouteContext treats sandbox.root_directory === null as explicit repo root, not 'fall back to repo default'", async () => {
  // Regression for codex P1 review on PR #301: a sandbox launched with an
  // explicit "Repo root" override on a monorepo whose repo default is
  // packages/api must report rootDirectory === null (the explicit
  // override sentinel), not collapse to repo default. The route-context
  // type is `string | null | undefined`; null preserves the three-way
  // distinction so future routes that need to branch on "explicit
  // override vs missing data" can.
  const { loadOwnedSandboxRouteContext } = await loadSandboxRouteContext();

  const result = await loadOwnedSandboxRouteContext(
    buildSandboxRouteContextRequest(),
    "sb-1",
    { select: "sandbox_id, root_directory, repo:repos(root_directory)" },
    {
      getSandboxServiceCredentials: async () => buildSandboxRouteContextAuth(),
      loadOwnedSandboxRecord: async () =>
        buildSandboxRouteContextRecord({
          root_directory: null,
          repo: [{ root_directory: "packages/api" }],
        }),
      resolveSandboxRecordContext: async () => ({
        ok: true,
        context: {
          ownership: {
            source: "record",
            billingSource: "platform",
            credentialSource: "platform",
            projectId: "project-123",
            teamId: null,
          },
          credentials: {
            vercelToken: "resolved-token",
            vercelTeamId: null,
            vercelProjectId: "project-123",
          },
        },
      }),
      getSandbox: async () => ({ status: "running" }) as never,
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rootDirectory, null);
});

test("loadOwnedSandboxRouteContext returns the sandbox subdirectory verbatim even when repo.root_directory is null", async () => {
  // Sandbox launched at apps/web on a repo whose persistent default is
  // null (e.g. a non-monorepo with no configured subdirectory) — must
  // return the sandbox's own path, not collapse to undefined.
  const { loadOwnedSandboxRouteContext } = await loadSandboxRouteContext();

  const result = await loadOwnedSandboxRouteContext(
    buildSandboxRouteContextRequest(),
    "sb-1",
    { select: "sandbox_id, root_directory, repo:repos(root_directory)" },
    {
      getSandboxServiceCredentials: async () => buildSandboxRouteContextAuth(),
      loadOwnedSandboxRecord: async () =>
        buildSandboxRouteContextRecord({
          root_directory: "apps/web",
          repo: [{ root_directory: null }],
        }),
      resolveSandboxRecordContext: async () => ({
        ok: true,
        context: {
          ownership: {
            source: "record",
            billingSource: "platform",
            credentialSource: "platform",
            projectId: "project-123",
            teamId: null,
          },
          credentials: {
            vercelToken: "resolved-token",
            vercelTeamId: null,
            vercelProjectId: "project-123",
          },
        },
      }),
      getSandbox: async () => ({ status: "running" }) as never,
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rootDirectory, "apps/web");
});

test("loadOwnedSandboxRouteContext falls back to repo.root_directory only when the SELECT omitted sandbox.root_directory", async () => {
  // Backward compat: legacy routes whose SELECT string predates this PR
  // never include sandbox.root_directory, so the field is undefined on
  // the loaded record. Those routes must continue to honour the repo's
  // persistent default rather than treating it as repo root.
  const { loadOwnedSandboxRouteContext } = await loadSandboxRouteContext();

  const result = await loadOwnedSandboxRouteContext(
    buildSandboxRouteContextRequest(),
    "sb-1",
    { select: "sandbox_id, repo:repos(root_directory)" },
    {
      getSandboxServiceCredentials: async () => buildSandboxRouteContextAuth(),
      loadOwnedSandboxRecord: async () =>
        buildSandboxRouteContextRecord({
          // root_directory deliberately not present on the row.
          repo: [{ root_directory: "packages/api" }],
        }),
      resolveSandboxRecordContext: async () => ({
        ok: true,
        context: {
          ownership: {
            source: "record",
            billingSource: "platform",
            credentialSource: "platform",
            projectId: "project-123",
            teamId: null,
          },
          credentials: {
            vercelToken: "resolved-token",
            vercelTeamId: null,
            vercelProjectId: "project-123",
          },
        },
      }),
      getSandbox: async () => ({ status: "running" }) as never,
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rootDirectory, "packages/api");
});

test("resolveLoadedSandboxRouteContext can skip sandbox client hydration", async () => {
  const { resolveLoadedSandboxRouteContext } = await loadSandboxRouteContext();

  const result = await resolveLoadedSandboxRouteContext(
    {
      ok: true,
      auth: buildSandboxRouteContextAuth(),
      record: buildSandboxRouteContextRecord(),
      repo: null,
      rootDirectory: undefined,
    },
    {
      hydrateSandboxClient: false,
    },
    {
      resolveSandboxRecordContext: async () => ({
        ok: true,
        context: {
          ownership: {
            source: "record",
            billingSource: "platform",
            credentialSource: "platform",
            projectId: "project-123",
            teamId: null,
          },
          credentials: {
            vercelToken: "resolved-token",
            vercelTeamId: null,
            vercelProjectId: "project-123",
          },
        },
      }),
      getSandbox: async () => {
        throw new Error("getSandbox should not be called");
      },
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sandbox, null);
});
