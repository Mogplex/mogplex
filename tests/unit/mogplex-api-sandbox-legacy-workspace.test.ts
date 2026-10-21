import assert from "node:assert/strict";
import test from "node:test";
import { buildPersistedPersistentRestartRecord } from "./helpers/sandbox-restart-route-fixtures";
import type { SandboxServiceCredentials } from "../../lib/sandbox/get-user-credentials";
import { buildSandboxName } from "../../lib/sandbox/sandbox-name";

const TEAM_ID = "00000000-0000-4000-8000-000000000456";
const REPO_ID = "00000000-0000-4000-8000-000000000123";
const serviceCredentials: SandboxServiceCredentials = {
  userId: "user-1",
  productTeamId: TEAM_ID,
  vercelToken: "platform-token",
  vercelTeamId: null,
  vercelProjectId: "platform-project",
  allowPlatformSandbox: true,
  userVercelToken: "user-token",
  userVercelTeamId: "user-team",
  accountDefaultVercelProjectId: null,
  accountDefaultVercelTeamId: null,
};
const identity = { userId: "user-1", repoId: REPO_ID, workingBranch: "main" };
type StoredSandbox = ReturnType<
  typeof buildPersistedPersistentRestartRecord
> & {
  product_team_id: string | null;
  billing_source?: "platform" | "user_vercel_project" | null;
  billing_project_id?: string | null;
  billing_team_id?: string | null;
};
async function withSavedWorkspaces(
  runTest: (fixture: {
    legacy: StoredSandbox;
    records: StoredSandbox[];
    deps: ReturnType<
      (typeof import("../../app/api/v1/mogplex/sandboxes/_lib/launch-deps"))["createMogplexApiSandboxPostDeps"]
    >;
    providerNames: string[];
    claims: Set<string>;
    provider: {
      status: string;
      persistent: boolean;
      missing: boolean;
      recordDisappears: boolean;
      expectedCredentials?: {
        vercelToken: string;
        vercelProjectId: string;
        vercelTeamId?: string | null;
      };
    };
  }) => Promise<void>
) {
  process.env.MOGPLEX_DATA_BACKEND = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const legacy = {
    ...buildPersistedPersistentRestartRecord({
      id: "saved-personal-workspace",
      user_id: identity.userId,
      repo_id: REPO_ID,
      working_branch: "main",
      sandbox_id: buildSandboxName({ ...identity, rootDirectory: null }),
      status: "stopped",
    }),
    product_team_id: null,
  };
  const records: StoredSandbox[] = [legacy];
  const claims = new Set(["boot-claim"]);
  const provider = {
    status: "stopped",
    persistent: true,
    missing: false,
    recordDisappears: false,
    expectedCredentials: undefined as
      | {
          vercelToken: string;
          vercelProjectId: string;
          vercelTeamId?: string | null;
        }
      | undefined,
  };
  let legacyLookups = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/limit_events" && init?.method === "DELETE") {
      if (
        url.searchParams.get("user_id") === `eq.${identity.userId}` &&
        url.searchParams.get("route_key") === "eq.sandbox_boot" &&
        url.searchParams.get("decision") === "eq.allowed"
      ) {
        claims.delete(
          (url.searchParams.get("claim_id") ?? "").replace(/^eq\./, "")
        );
      }
      return Response.json(null);
    }
    assert.equal(
      init?.method ?? "GET",
      "GET",
      "Must not create a new workspace record"
    );
    assert.equal(url.pathname, "/rest/v1/sandboxes");
    if (url.searchParams.get("sandbox_id") === `eq.${legacy.sandbox_id}`) {
      legacyLookups++;
      if (provider.recordDisappears && legacyLookups > 1)
        return Response.json(null);
    }
    const found = records.filter(
      (record) =>
        [
          "repo_id",
          "user_id",
          "working_branch",
          "sandbox_id",
          "root_directory",
          "product_team_id",
        ].every((key) => {
          const filter = url.searchParams.get(key);
          if (!filter) return true;
          const value = record[key as keyof StoredSandbox];
          return filter === "is.null"
            ? value === null
            : filter === `eq.${value}`;
        }) &&
        (url.searchParams.get("status") ?? "").includes(String(record.status))
    );
    return Response.json(
      url.searchParams.has("sandbox_id") ? (found[0] ?? null) : found
    );
  };
  try {
    const { createMogplexApiSandboxPostDeps } =
      await import("../../app/api/v1/mogplex/sandboxes/_lib/launch-deps");
    const { resolveNameCollision } = await import("../../lib/sandbox/launch");
    const providerNames: string[] = [];
    const deps = createMogplexApiSandboxPostDeps({
      resolveNameCollision: (input, policy) =>
        resolveNameCollision(input, {
          getSandbox: async (name, credentials) => {
            if (provider.expectedCredentials)
              assert.deepEqual(credentials, provider.expectedCredentials);
            providerNames.push(name);
            if (!records.some((record) => record.sandbox_id === name)) {
              throw new Error("Scoped provider probe failed");
            }
            if (provider.missing)
              throw Object.assign(new Error("Provider unavailable"), {
                status: 404,
              });
            return {
              status: provider.status,
              persistent: provider.persistent,
            } as never;
          },
          findNamedSandbox: async () => null,
          deleteSandbox: async () => {
            throw new Error("Must not delete saved work");
          },
          deleteSandboxByName: async () => {
            throw new Error("Must not delete saved work");
          },
          ...policy,
        }),
    });
    await runTest({ legacy, records, deps, providerNames, provider, claims });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function collisionInput(rootDirectory: string | null = null) {
  return {
    ...identity,
    productTeamId: TEAM_ID,
    rootDirectory,
    name: buildSandboxName({
      ...identity,
      productTeamId: TEAM_ID,
      rootDirectory,
    }),
    credentials: { vercelToken: "vercel-token", vercelProjectId: "project-1" },
    serviceCredentials,
  };
}

test("a refused legacy collision releases its provisional boot claim", async () => {
  await withSavedWorkspaces(async ({ deps, provider, claims }) => {
    const { maybeReturnNameCollisionResponse } =
      await import("../../app/api/sandbox/_lib/launch");
    const input = collisionInput();
    provider.missing = true;
    await assert.rejects(
      maybeReturnNameCollisionResponse(
        deps as never,
        {
          repoId: REPO_ID,
          creds: { userId: identity.userId },
          actorUserId: identity.userId,
          productTeamId: TEAM_ID,
          effectiveRootDirectory: null,
          runtime: "node22",
          launchRequest: { workingBranch: "main", baseBranch: "main" },
          createContext: {
            credentials: input.credentials,
            ownership: { billingSource: "platform" },
          },
        } as never,
        "boot-claim",
        new Request("https://mogplex.internal/api/sandbox")
      ),
      /Saved workspace is unavailable/
    );
    assert.equal(claims.size, 0);
  });
});

for (const repoRoot of [null, "apps/web"]) {
  test(`omitting the launch root resolves repository default ${repoRoot ?? "root"} before legacy lookup`, async () => {
    await withSavedWorkspaces(async ({ legacy, deps }) => {
      const { resolveLaunchRootDirectory } =
        await import("../../app/api/sandbox/_lib/utils");
      const request = {
        repoId: REPO_ID,
        baseBranch: "main",
        workingBranch: "main",
        createBranch: false,
        rootDirectory: undefined,
        restoreSnapshotId: null,
        restoreSnapshotProjectId: null,
        restoreSnapshotTeamId: null,
      };
      const root = resolveLaunchRootDirectory({
        request,
        repo: { root_directory: repoRoot },
      });
      legacy.status = "running";
      legacy.root_directory = repoRoot;
      legacy.sandbox_id = buildSandboxName({
        ...identity,
        rootDirectory: repoRoot,
      });
      const result = await deps.getActiveSandboxForRepo(
        REPO_ID,
        identity.userId,
        "main",
        root,
        TEAM_ID
      );
      assert.equal(root, repoRoot);
      assert.equal(result?.id, legacy.id);
      if (repoRoot)
        assert.equal(
          resolveLaunchRootDirectory({
            request: { ...request, rootDirectory: null },
            repo: { root_directory: repoRoot },
          }),
          null
        );
    });
  });
}

test("team launch keeps an active legacy personal workspace", async () => {
  await withSavedWorkspaces(async ({ legacy, deps }) => {
    legacy.status = "running";
    const result = await deps.getActiveSandboxForRepo(
      REPO_ID,
      identity.userId,
      "main",
      null,
      TEAM_ID
    );
    assert.equal(result?.id, legacy.id);
    assert.equal(result?.sandbox_id, legacy.sandbox_id);
  });
});

test("team launch restarts the stopped legacy record instead of making a fresh checkout", async () => {
  await withSavedWorkspaces(async ({ legacy, deps, providerNames }) => {
    const result = await deps.resolveNameCollision(collisionInput());
    assert.equal(result.kind, "restart");
    if (result.kind === "restart") {
      assert.equal(result.record.id, legacy.id);
      assert.equal(result.record.sandbox_id, legacy.sandbox_id);
    }
    assert.deepEqual(providerNames, [legacy.sandbox_id]);
  });
});

test("a usable non-persistent legacy workspace resumes without entering restart", async () => {
  await withSavedWorkspaces(
    async ({ legacy, deps, provider, providerNames }) => {
      legacy.persistent = false;
      legacy.status = "paused";
      provider.persistent = false;
      provider.status = "running";
      const result = await deps.resolveNameCollision(collisionInput());
      assert.equal(result.kind, "resume");
      if (result.kind === "resume") assert.equal(result.record.id, legacy.id);
      assert.deepEqual(providerNames, [legacy.sandbox_id]);
    }
  );
});

test("an unavailable legacy provider never falls through to a fresh checkout", async () => {
  await withSavedWorkspaces(async ({ deps, provider }) => {
    provider.missing = true;
    await assert.rejects(
      deps.resolveNameCollision(collisionInput()),
      /Saved workspace is unavailable/
    );
  });
});

test("a legacy record disappearing during the provider probe is never adopted into a new record", async () => {
  await withSavedWorkspaces(async ({ deps, provider, records }) => {
    provider.status = "running";
    provider.recordDisappears = true;
    await assert.rejects(
      deps.resolveNameCollision(collisionInput()),
      /Saved workspace is unavailable/
    );
    assert.equal(records.length, 1);
  });
});

test("a stopped non-persistent legacy workspace is kept for explicit recovery", async () => {
  await withSavedWorkspaces(async ({ legacy, deps, provider }) => {
    legacy.persistent = false;
    provider.persistent = false;
    await assert.rejects(
      deps.resolveNameCollision(collisionInput()),
      /Saved workspace is unavailable/
    );
  });
});

test("a stale persistent flag delegates to recovery without deleting the saved workspace", async () => {
  await withSavedWorkspaces(async ({ legacy, deps, provider }) => {
    assert.equal(legacy.persistent, true);
    provider.persistent = false;
    const result = await deps.resolveNameCollision(collisionInput());
    assert.equal(result.kind, "restart");
    if (result.kind === "restart") assert.equal(result.record.id, legacy.id);
  });
});

test("an existing team-scoped workspace takes precedence over the legacy namespace", async () => {
  await withSavedWorkspaces(
    async ({ legacy, records, deps, providerNames }) => {
      const input = collisionInput();
      records.unshift({
        ...legacy,
        id: "saved-team-workspace",
        product_team_id: TEAM_ID,
        sandbox_id: input.name,
      });
      const result = await deps.resolveNameCollision(input);
      assert.equal(result.kind, "restart");
      if (result.kind === "restart")
        assert.equal(result.record.id, "saved-team-workspace");
      assert.deepEqual(providerNames, [input.name]);
    }
  );
});

test("an active personal workspace does not displace a stopped team workspace", async () => {
  await withSavedWorkspaces(async ({ legacy, records, deps }) => {
    records.unshift({
      ...legacy,
      id: "saved-team-workspace",
      product_team_id: TEAM_ID,
      sandbox_id: collisionInput().name,
    });
    legacy.status = "running";
    const active = await deps.getActiveSandboxForRepo(
      REPO_ID,
      identity.userId,
      "main",
      null,
      TEAM_ID
    );
    assert.equal(active, null);
    const result = await deps.resolveNameCollision(collisionInput());
    assert.equal(result.kind, "restart");
    if (result.kind === "restart")
      assert.equal(result.record.id, "saved-team-workspace");
  });
});

for (const status of ["creating", "installing"]) {
  test(`an active personal workspace never displaces a ${status} team workspace`, async () => {
    await withSavedWorkspaces(
      async ({ legacy, records, deps, providerNames }) => {
        legacy.status = "running";
        records.unshift({
          ...legacy,
          id: "booting-team-workspace",
          product_team_id: TEAM_ID,
          sandbox_id: collisionInput().name,
          status,
        });
        const active = await deps.getActiveSandboxForRepo(
          REPO_ID,
          identity.userId,
          "main",
          null,
          TEAM_ID
        );
        assert.equal(active?.id, "booting-team-workspace");
        assert.deepEqual(providerNames, []);
      }
    );
  });
}

test("legacy lookup does not cross root directories", async () => {
  await withSavedWorkspaces(async ({ legacy, deps, providerNames }) => {
    const input = collisionInput("apps/other");
    await assert.rejects(
      deps.resolveNameCollision(input),
      /Scoped provider probe failed/
    );
    assert.deepEqual(providerNames, [input.name]);
    assert.notEqual(input.name, legacy.sandbox_id);
  });
});

for (const billingSource of [
  "platform",
  "user_vercel_project",
  null,
] as const) {
  test(`team target changes preserve the saved ${billingSource ?? "inferred"} provider credentials`, async () => {
    await withSavedWorkspaces(
      async ({ legacy, deps, provider, claims, providerNames }) => {
        const { maybeReturnNameCollisionResponse } =
          await import("../../app/api/sandbox/_lib/launch");
        legacy.status = "paused";
        legacy.billing_source = billingSource;
        legacy.billing_project_id = "saved-project";
        legacy.billing_team_id = "saved-team";
        provider.status = "running";
        provider.expectedCredentials =
          billingSource === "platform"
            ? {
                vercelToken: "platform-token",
                vercelProjectId: "platform-project",
                vercelTeamId: null,
              }
            : {
                vercelToken: "user-token",
                vercelProjectId: "saved-project",
                vercelTeamId: "saved-team",
              };
        const input = collisionInput();
        const response = await maybeReturnNameCollisionResponse(
          deps as never,
          {
            repoId: REPO_ID,
            creds: serviceCredentials,
            actorUserId: identity.userId,
            productTeamId: TEAM_ID,
            effectiveRootDirectory: null,
            runtime: "node22",
            launchRequest: { workingBranch: "main", baseBranch: "main" },
            createContext: {
              credentials: input.credentials,
              ownership: { billingSource: "user_vercel_project" },
            },
          } as never,
          "boot-claim",
          new Request("https://mogplex.internal/api/sandbox")
        );
        assert.ok(response);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).sandbox.id, legacy.id);
        assert.equal(claims.size, 0);
        providerNames.length = 0;
        await assert.rejects(
          deps.resolveNameCollision({
            ...input,
            serviceCredentials: {
              ...serviceCredentials,
              allowPlatformSandbox: false,
              userVercelToken: null,
            },
          }),
          /Saved workspace is unavailable/
        );
        assert.deepEqual(
          providerNames,
          [],
          "unavailable record credentials must not probe the new launch target"
        );
      }
    );
  });
}
