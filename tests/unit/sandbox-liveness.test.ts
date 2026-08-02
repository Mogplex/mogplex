import assert from "node:assert/strict";
import test from "node:test";
import type {
  SandboxContextResult,
  SandboxVercelContext,
} from "@/lib/sandbox/context";
import type { SandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";

async function loadSandboxLiveness() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/liveness");
}

const missingBillingProjectError =
  "Sandbox is missing its stored Vercel project for user-owned billing.";

function buildSandboxServiceCredentials(
  overrides: Partial<SandboxServiceCredentials> = {}
): SandboxServiceCredentials {
  return {
    userId: "user-1",
    vercelToken: "platform-token",
    vercelTeamId: null,
    vercelProjectId: "project-1",
    userVercelToken: null,
    userVercelTeamId: null,
    accountDefaultVercelProjectId: null,
    accountDefaultVercelTeamId: null,
    ...overrides,
  };
}

function buildPlatformCredentials(
  overrides: Partial<
    Pick<
      SandboxServiceCredentials,
      "vercelToken" | "vercelTeamId" | "vercelProjectId"
    >
  > = {}
) {
  return {
    vercelToken: "platform-token",
    vercelTeamId: null,
    vercelProjectId: "platform-project",
    ...overrides,
  };
}

function buildResolvedPlatformContext(): SandboxContextResult<SandboxVercelContext> {
  return {
    ok: true as const,
    context: {
      ownership: {
        source: "record" as const,
        billingSource: "platform" as const,
        credentialSource: "platform" as const,
        projectId: "platform-project",
        teamId: null,
      },
      credentials: {
        vercelToken: "platform-token",
        vercelTeamId: null,
        vercelProjectId: "platform-project",
      },
    },
  };
}

test("resolveActiveSandboxState treats old pending records as stale_pending", async () => {
  const { resolveActiveSandboxState } = await loadSandboxLiveness();

  const result = await resolveActiveSandboxState(
    {
      sandboxCredentials: buildSandboxServiceCredentials(),
      record: {
        id: "sandbox-1",
        sandbox_id: "pending",
        status: "creating",
        created_at: "2026-04-01T10:00:00.000Z",
        last_boot_started_at: null,
      },
    },
    {
      nowMs: () => new Date("2026-04-01T10:03:00.000Z").getTime(),
    }
  );

  assert.deepEqual(result, { kind: "stale_pending" });
});

test("resolveActiveSandboxState returns unresolvable when durable billing context cannot be resolved", async () => {
  const { resolveActiveSandboxState } = await loadSandboxLiveness();

  const result = await resolveActiveSandboxState(
    {
      sandboxCredentials: buildSandboxServiceCredentials(),
      record: {
        id: "sandbox-1",
        sandbox_id: "vm_123",
        status: "running",
        created_at: "2026-04-01T10:00:00.000Z",
      },
    },
    {
      resolveSandboxRecordContext: async () => ({
        ok: false,
        error: missingBillingProjectError,
        status: 400,
      }),
    }
  );

  assert.deepEqual(result, {
    kind: "unresolvable",
    error: missingBillingProjectError,
    status: 400,
  });
});

test("findStaleActiveSandboxIds skips records whose durable credentials cannot be resolved", async () => {
  const { findStaleActiveSandboxIds } = await loadSandboxLiveness();

  const result = await findStaleActiveSandboxIds(
    {
      sandboxCredentials: buildSandboxServiceCredentials(),
      records: [
        {
          id: "sandbox-good",
          sandbox_id: "vm_live",
          status: "running",
          created_at: "2026-04-01T10:00:00.000Z",
        },
        {
          id: "sandbox-skip",
          sandbox_id: "vm_skip",
          status: "running",
          created_at: "2026-04-01T10:00:00.000Z",
        },
      ],
    },
    {
      resolveSandboxRecordContext: async ({ record }) => {
        if ((record as { sandbox_id?: string }).sandbox_id === "vm_skip") {
          return {
            ok: false,
            error: missingBillingProjectError,
            status: 400,
          };
        }

        return {
          ok: true,
          context: {
            ownership: {
              source: "record",
              billingSource: "platform",
              credentialSource: "platform",
              projectId: "project-1",
              teamId: null,
            },
            credentials: {
              vercelToken: "platform-token",
              vercelTeamId: null,
              vercelProjectId: "project-1",
            },
          },
        };
      },
      listVercelSandboxes: async () =>
        [{ name: "vm_live", status: "running" }] as never,
    }
  );

  assert.deepEqual(Array.from(result.staleIds), []);
  assert.deepEqual(Array.from(result.skippedIds), ["sandbox-skip"]);
});

test("resolveCrossUserActiveSandboxLivenessMap groups records by resolved Vercel scope", async () => {
  const { resolveCrossUserActiveSandboxLivenessMap } =
    await loadSandboxLiveness();
  let listCalls = 0;
  const userLoads: string[] = [];

  const results = await resolveCrossUserActiveSandboxLivenessMap(
    {
      platformCredentials: buildPlatformCredentials(),
      loadUserVercelCredentials: async (userId) => {
        userLoads.push(userId);
        return {
          userVercelToken: `${userId}-token`,
          userVercelTeamId: null,
          accountDefaultVercelProjectId: null,
          accountDefaultVercelTeamId: null,
        };
      },
      records: [
        {
          id: "sandbox-1",
          user_id: "user-1",
          sandbox_id: "vm_live",
          status: "running",
          created_at: "2026-04-01T10:00:00.000Z",
        },
        {
          id: "sandbox-2",
          user_id: "user-2",
          sandbox_id: "vm_gone",
          status: "running",
          created_at: "2026-04-01T10:00:00.000Z",
        },
      ],
    },
    {
      resolveSandboxRecordContext: async () => ({
        ok: true,
        context: {
          ownership: {
            source: "record",
            billingSource: "user_vercel_project",
            credentialSource: "user",
            projectId: "shared-project",
            teamId: "shared-team",
          },
          credentials: {
            vercelToken: "shared-user-token",
            vercelTeamId: "shared-team",
            vercelProjectId: "shared-project",
          },
        },
      }),
      listVercelSandboxes: async () => {
        listCalls += 1;
        return [{ name: "vm_live", status: "running" }] as never;
      },
    }
  );

  assert.deepEqual(userLoads, ["user-1", "user-2"]);
  assert.equal(listCalls, 1);
  assert.deepEqual(results.get("sandbox-1"), {
    kind: "running",
    credentials: {
      vercelToken: "shared-user-token",
      vercelTeamId: "shared-team",
      vercelProjectId: "shared-project",
    },
  });
  assert.deepEqual(results.get("sandbox-2"), {
    kind: "stopped",
    credentials: {
      vercelToken: "shared-user-token",
      vercelTeamId: "shared-team",
      vercelProjectId: "shared-project",
    },
  });
});

test("resolveCrossUserActiveSandboxLivenessMap marks durable credential failures as unresolvable", async () => {
  const { resolveCrossUserActiveSandboxLivenessMap } =
    await loadSandboxLiveness();

  const results = await resolveCrossUserActiveSandboxLivenessMap(
    {
      platformCredentials: buildPlatformCredentials(),
      loadUserVercelCredentials: async () => ({
        userVercelToken: null,
        userVercelTeamId: null,
        accountDefaultVercelProjectId: null,
        accountDefaultVercelTeamId: null,
      }),
      records: [
        {
          id: "sandbox-1",
          user_id: "user-1",
          sandbox_id: "vm_123",
          status: "running",
          created_at: "2026-04-01T10:00:00.000Z",
        },
      ],
    },
    {
      resolveSandboxRecordContext: async () => ({
        ok: false,
        error: missingBillingProjectError,
        status: 400,
      }),
    }
  );

  assert.deepEqual(results.get("sandbox-1"), {
    kind: "unresolvable",
    error: missingBillingProjectError,
    status: 400,
  });
});

test("resolveActiveSandboxState keeps stored running records active when Vercel lookups fail transiently", async () => {
  const { resolveActiveSandboxState } = await loadSandboxLiveness();
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];

  try {
    console.warn = (...args) => {
      warnings.push(args);
    };

    const result = await resolveActiveSandboxState(
      {
        sandboxCredentials: buildSandboxServiceCredentials(),
        record: {
          id: "sandbox-lookup-transient",
          sandbox_id: "vm_transient",
          status: "running",
          created_at: "2026-04-01T10:00:00.000Z",
        },
      },
      {
        resolveSandboxRecordContext: async () => buildResolvedPlatformContext(),
        listVercelSandboxes: async () => {
          throw new Error("temporary list failure");
        },
        getSandbox: async () => {
          throw new Error("temporary get failure");
        },
      }
    );

    assert.deepEqual(result, { kind: "running" });
    assert.equal(warnings.length, 2);
  } finally {
    console.warn = originalWarn;
  }
});

test("findStaleActiveSandboxIds does not retire active records on transient Vercel lookup failures", async () => {
  const { findStaleActiveSandboxIds } = await loadSandboxLiveness();
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];

  try {
    console.warn = (...args) => {
      warnings.push(args);
    };

    const result = await findStaleActiveSandboxIds(
      {
        sandboxCredentials: buildSandboxServiceCredentials(),
        records: [
          {
            id: "sandbox-lookup-transient",
            sandbox_id: "vm_transient",
            status: "running",
            created_at: "2026-04-01T10:00:00.000Z",
          },
        ],
      },
      {
        resolveSandboxRecordContext: async () => buildResolvedPlatformContext(),
        listVercelSandboxes: async () => {
          throw new Error("temporary list failure");
        },
        getSandbox: async () => {
          throw new Error("temporary get failure");
        },
      }
    );

    assert.deepEqual(Array.from(result.staleIds), []);
    assert.deepEqual(Array.from(result.skippedIds), []);
    assert.equal(warnings.length, 2);
  } finally {
    console.warn = originalWarn;
  }
});
