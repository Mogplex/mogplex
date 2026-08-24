import {
  getSandboxByName as getSandbox,
  listSandboxesForCredentials as listVercelSandboxes,
} from "@/lib/sandbox/sdk-adapter";
import { resolveSandboxRecordContext } from "@/lib/sandbox/context";
import type { SandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";

export const STALE_PENDING_RECOVERY_MS = 90_000;

export type ActiveSandboxRecordLike = {
  id: string;
  sandbox_id: string;
  status: string;
  created_at?: string;
  last_boot_started_at?: string | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
};

type VmEntry = {
  // In v2 of @vercel/sandbox the sandbox is identified by `name`. The DB
  // column is still called `sandbox_id` so callers use that field, but the
  // value stored there is the Vercel-side name.
  name: string;
  status: string;
};

export type SandboxVmCredentials = {
  vercelToken: string;
  vercelTeamId: string | null;
  vercelProjectId: string;
};

type ContextResolvedActiveSandbox = {
  record: ActiveSandboxRecordLike;
  credentials: SandboxVmCredentials;
};

type LivenessDeps = {
  resolveSandboxRecordContext: typeof resolveSandboxRecordContext;
  getSandbox: typeof getSandbox;
  listVercelSandboxes: typeof listVercelSandboxes;
  nowMs: () => number;
};

const defaultLivenessDeps: LivenessDeps = {
  resolveSandboxRecordContext,
  getSandbox,
  listVercelSandboxes,
  nowMs: () => Date.now(),
};

export function isStalePendingSandbox(
  record: Pick<
    ActiveSandboxRecordLike,
    "sandbox_id" | "status" | "created_at" | "last_boot_started_at"
  >,
  nowMs = Date.now()
) {
  if (record.sandbox_id !== "pending") return false;
  if (record.status !== "creating" && record.status !== "installing")
    return false;

  const startedAt = record.last_boot_started_at || record.created_at;
  if (!startedAt) return false;

  const ageMs = nowMs - new Date(startedAt).getTime();
  return Number.isFinite(ageMs) && ageMs > STALE_PENDING_RECOVERY_MS;
}

export type ActiveSandboxStateResult =
  | {
      kind:
        | "running"
        | "pending"
        | "cleanup_pending"
        | "stopped"
        | "stale_pending";
    }
  | { kind: "unresolvable"; error: string; status: 400 | 403 | 500 };

export type ActiveSandboxLivenessResult =
  | { kind: "running" | "stopped"; credentials: SandboxVmCredentials }
  | { kind: "cleanup_pending"; credentials: SandboxVmCredentials }
  | { kind: "pending"; credentials?: SandboxVmCredentials }
  | { kind: "stale_pending" }
  | { kind: "unresolvable"; error: string; status: 400 | 403 | 500 };

type CrossUserActiveSandboxRecordLike = ActiveSandboxRecordLike & {
  user_id: string;
};

function normalizeVmState(
  status: string
): "running" | "pending" | "cleanup_pending" | "stopped" {
  if (status === "running") return "running";
  if (status === "pending") return "pending";
  if (status === "stopping" || status === "snapshotting") {
    return "cleanup_pending";
  }
  return "stopped";
}

function normalizeRecordedActiveState(
  status: string
): "running" | "pending" | "stopped" {
  if (status === "running") return "running";
  if (status === "creating" || status === "installing") return "pending";
  return "stopped";
}

function buildCredentialGroupKey(credentials: SandboxVmCredentials) {
  return [
    credentials.vercelProjectId,
    credentials.vercelTeamId || "",
    credentials.vercelToken,
  ].join(":");
}

async function resolveGroupedVmLiveness(
  records: ContextResolvedActiveSandbox[],
  deps: LivenessDeps
) {
  const results = new Map<string, ActiveSandboxLivenessResult>();
  const groups = new Map<
    string,
    {
      credentials: SandboxVmCredentials;
      records: ContextResolvedActiveSandbox[];
    }
  >();

  for (const item of records) {
    const key = buildCredentialGroupKey(item.credentials);
    const group = groups.get(key);
    if (group) {
      group.records.push(item);
    } else {
      groups.set(key, {
        credentials: item.credentials,
        records: [item],
      });
    }
  }

  for (const group of groups.values()) {
    try {
      const vms = await deps.listVercelSandboxes(group.credentials);
      const vmMap = new Map<string, VmEntry>(
        vms.map((vm: VmEntry) => [vm.name, vm])
      );

      for (const item of group.records) {
        const vm = vmMap.get(item.record.sandbox_id);
        results.set(item.record.id, {
          kind: vm ? normalizeVmState(vm.status) : "stopped",
          credentials: item.credentials,
        });
      }
      continue;
    } catch (error) {
      console.warn(
        `[sandbox/liveness] Failed to list Vercel sandboxes for project ${group.credentials.vercelProjectId}; falling back to individual lookups`,
        error
      );
      // Fall back to a per-VM fetch for this credential scope.
    }

    await Promise.all(
      group.records.map(async (item) => {
        try {
          const vm = await deps.getSandbox(
            item.record.sandbox_id,
            item.credentials
          );
          results.set(item.record.id, {
            kind: normalizeVmState(vm.status),
            credentials: item.credentials,
          });
        } catch (error) {
          console.warn(
            `[sandbox/liveness] Failed to load sandbox ${item.record.sandbox_id}; reusing persisted lifecycle state`,
            error
          );
          results.set(item.record.id, {
            kind: normalizeRecordedActiveState(item.record.status),
            credentials: item.credentials,
          });
        }
      })
    );
  }

  return results;
}

export async function resolveActiveSandboxLivenessMap(
  input: {
    sandboxCredentials: SandboxServiceCredentials;
    records: ActiveSandboxRecordLike[];
  },
  overrides: Partial<LivenessDeps> = {}
) {
  const deps: LivenessDeps = {
    ...defaultLivenessDeps,
    ...overrides,
  };

  const results = new Map<string, ActiveSandboxLivenessResult>();
  const contextualRecords: ContextResolvedActiveSandbox[] = [];

  for (const record of input.records) {
    if (record.sandbox_id === "pending") {
      results.set(
        record.id,
        isStalePendingSandbox(record, deps.nowMs())
          ? { kind: "stale_pending" }
          : { kind: "pending" }
      );
      continue;
    }

    const contextResult = await deps.resolveSandboxRecordContext({
      sandboxCredentials: input.sandboxCredentials,
      record,
    });
    if (!contextResult.ok) {
      results.set(record.id, {
        kind: "unresolvable",
        error: contextResult.error,
        status: contextResult.status,
      });
      continue;
    }

    contextualRecords.push({
      record,
      credentials: {
        vercelToken: contextResult.context.credentials.vercelToken,
        vercelTeamId: contextResult.context.credentials.vercelTeamId ?? null,
        vercelProjectId: contextResult.context.credentials.vercelProjectId,
      },
    });
  }

  const vmResults = await resolveGroupedVmLiveness(contextualRecords, deps);
  for (const [id, result] of vmResults) {
    results.set(id, result);
  }

  return results;
}

export async function resolveCrossUserActiveSandboxLivenessMap(
  input: {
    platformCredentials: Pick<
      SandboxServiceCredentials,
      "vercelToken" | "vercelTeamId" | "vercelProjectId"
    >;
    loadUserVercelCredentials: (
      userId: string
    ) => Promise<
      Pick<
        SandboxServiceCredentials,
        | "userVercelToken"
        | "userVercelTeamId"
        | "accountDefaultVercelProjectId"
        | "accountDefaultVercelTeamId"
      >
    >;
    records: CrossUserActiveSandboxRecordLike[];
  },
  overrides: Partial<LivenessDeps> = {}
) {
  const deps: LivenessDeps = {
    ...defaultLivenessDeps,
    ...overrides,
  };

  const results = new Map<string, ActiveSandboxLivenessResult>();
  const contextualRecords: ContextResolvedActiveSandbox[] = [];
  const userCredentialCache = new Map<
    string,
    Promise<
      Pick<
        SandboxServiceCredentials,
        | "userVercelToken"
        | "userVercelTeamId"
        | "accountDefaultVercelProjectId"
        | "accountDefaultVercelTeamId"
      >
    >
  >();

  for (const record of input.records) {
    if (record.sandbox_id === "pending") {
      results.set(
        record.id,
        isStalePendingSandbox(record, deps.nowMs())
          ? { kind: "stale_pending" }
          : { kind: "pending" }
      );
      continue;
    }

    let userCredentials = userCredentialCache.get(record.user_id);
    if (!userCredentials) {
      userCredentials = input
        .loadUserVercelCredentials(record.user_id)
        .catch((error) => {
          console.warn(
            `[sandbox/liveness] Failed to load user Vercel credentials for ${record.user_id}; falling back to platform credentials`,
            error
          );
          return {
            userVercelToken: null,
            userVercelTeamId: null,
            accountDefaultVercelProjectId: null,
            accountDefaultVercelTeamId: null,
          };
        });
      userCredentialCache.set(record.user_id, userCredentials);
    }

    const resolvedUserCredentials = await userCredentials;
    const contextResult = await deps.resolveSandboxRecordContext({
      sandboxCredentials: {
        userId: record.user_id,
        ...input.platformCredentials,
        ...resolvedUserCredentials,
      },
      record,
    });
    if (!contextResult.ok) {
      results.set(record.id, {
        kind: "unresolvable",
        error: contextResult.error,
        status: contextResult.status,
      });
      continue;
    }

    contextualRecords.push({
      record,
      credentials: {
        vercelToken: contextResult.context.credentials.vercelToken,
        vercelTeamId: contextResult.context.credentials.vercelTeamId ?? null,
        vercelProjectId: contextResult.context.credentials.vercelProjectId,
      },
    });
  }

  const vmResults = await resolveGroupedVmLiveness(contextualRecords, deps);
  for (const [id, result] of vmResults) {
    results.set(id, result);
  }

  return results;
}

export async function resolveActiveSandboxState(
  input: {
    sandboxCredentials: SandboxServiceCredentials;
    record: ActiveSandboxRecordLike;
  },
  overrides: Partial<LivenessDeps> = {}
): Promise<ActiveSandboxStateResult> {
  const results = await resolveActiveSandboxLivenessMap(
    {
      sandboxCredentials: input.sandboxCredentials,
      records: [input.record],
    },
    overrides
  );
  const result = results.get(input.record.id);

  if (!result) {
    return {
      kind: "unresolvable",
      error: "Failed to resolve sandbox liveness.",
      status: 500,
    };
  }

  if (result.kind === "unresolvable") {
    return result;
  }

  return { kind: result.kind };
}

export async function findStaleActiveSandboxIds(
  input: {
    sandboxCredentials: SandboxServiceCredentials;
    records: ActiveSandboxRecordLike[];
  },
  overrides: Partial<LivenessDeps> = {}
) {
  const staleIds = new Set<string>();
  const skippedIds = new Set<string>();

  const results = await resolveActiveSandboxLivenessMap(input, overrides);

  for (const record of input.records) {
    const result = results.get(record.id);
    if (!result) continue;
    if (result.kind === "unresolvable") {
      skippedIds.add(record.id);
      continue;
    }
    if (result.kind === "stopped") {
      staleIds.add(record.id);
    }
  }

  return { staleIds, skippedIds };
}
