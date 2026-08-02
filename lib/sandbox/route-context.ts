import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSandbox } from "@/lib/sandbox/client";
// route-context keeps the direct getSandbox import because callers pass
// their own `{ resume }` option; the sdk-adapter helpers lock that to
// specific values (getSandboxByName=false, resumeSandboxByName=true).
import {
  getSandboxServiceCredentials,
  isSandboxCapabilityDeniedError,
} from "@/lib/sandbox/get-user-credentials";
import { resolveSandboxRecordContext } from "@/lib/sandbox/context";
import { normalizeRootDirectory } from "@/lib/repo-settings";
import {
  readActiveTeamIdHeader,
  type Capability,
} from "@/lib/team-capabilities";
import type { SandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";
import type {
  SandboxExecutionContext,
  SandboxVercelContext,
} from "@/lib/sandbox/context";
import type { Sandbox } from "@vercel/sandbox";

type SandboxRouteRepoRelation =
  | Record<string, unknown>
  | Record<string, unknown>[]
  | null
  | undefined;

export type SandboxRouteRecordLike = {
  sandbox_id: string;
  /**
   * Per-launch working subdirectory snapshot. Routes whose SELECT
   * string includes `root_directory` get the field; legacy SELECTs
   * leave it undefined and fall back to repo defaults at the
   * loadOwnedSandboxRouteRecord boundary.
   */
  root_directory?: string | null;
  repo?: SandboxRouteRepoRelation;
  [key: string]: unknown;
};

type NormalizedSandboxRepo<T> =
  T extends Array<infer U> ? U | null : Exclude<T, undefined> | null;

export type SandboxRouteFailure = {
  ok: false;
  status: number;
  error: string;
};

export type LoadedSandboxRouteRecord<R extends SandboxRouteRecordLike> = {
  ok: true;
  auth: SandboxServiceCredentials;
  record: R;
  repo: NormalizedSandboxRepo<R["repo"]>;
  /**
   * Three-way: undefined means the route's SELECT didn't include the
   * sandbox's `root_directory` (legacy code path; downstream callers
   * should fall back to repo default). null means the sandbox was
   * explicitly launched at repo root on a monorepo. string means a
   * subdirectory. Most current callers treat null and undefined the
   * same (both = "no subdirectory") via resolveSandboxPath, but the
   * distinction is preserved here so a future route that needs to
   * branch on "explicit override vs missing data" can.
   */
  rootDirectory: string | null | undefined;
};

export type LoadedSandboxRouteContext<R extends SandboxRouteRecordLike> =
  LoadedSandboxRouteRecord<R> & {
    context: SandboxVercelContext | SandboxExecutionContext;
    sandbox: Sandbox | null;
  };

type SandboxRouteRecordLoaderDeps = {
  getSandboxServiceCredentials: typeof getSandboxServiceCredentials;
  loadOwnedSandboxRecord: (
    sandboxId: string,
    userId: string,
    select: string
  ) => Promise<SandboxRouteRecordLike | null>;
};

type SandboxRouteContextLoaderDeps = {
  getSandbox: typeof getSandbox;
  resolveSandboxRecordContext: (
    input: Parameters<typeof resolveSandboxRecordContext>[0]
  ) => ReturnType<typeof resolveSandboxRecordContext>;
};

const defaultSandboxRouteRecordLoaderDeps: SandboxRouteRecordLoaderDeps = {
  getSandboxServiceCredentials,
  async loadOwnedSandboxRecord(
    sandboxId: string,
    userId: string,
    select: string
  ) {
    const { data } = await supabaseAdmin
      .from("sandboxes")
      .select(select)
      .eq("id", sandboxId)
      .eq("user_id", userId)
      .maybeSingle();

    return (data as SandboxRouteRecordLike | null) ?? null;
  },
};

const defaultSandboxRouteContextLoaderDeps: SandboxRouteContextLoaderDeps = {
  getSandbox,
  resolveSandboxRecordContext(input) {
    return resolveSandboxRecordContext(input);
  },
};

type LoadSandboxRouteRecordOptions = {
  select: string;
  notFoundMessage?: string;
  /**
   * When set, getSandboxServiceCredentials gates the request on this
   * capability before any sandbox row is loaded. Routes that mutate the
   * sandbox (exec, restart, stop, files write, delete, …) pass
   * `"tools.bash"`; read-only routes (status, health, tree, files read)
   * leave this off so viewers retain visibility. Denial returns a 403
   * SandboxRouteFailure with the SandboxCapabilityDeniedError message.
   */
  requireCapability?: Capability;
};

type LoadSandboxRouteContextOptions = LoadSandboxRouteRecordOptions & {
  includeAi?: boolean;
  hydrateSandboxClient?: boolean;
};

function normalizeRouteRepo<T extends SandboxRouteRepoRelation>(
  repo: T
): NormalizedSandboxRepo<T> {
  if (Array.isArray(repo)) {
    return (repo[0] ?? null) as NormalizedSandboxRepo<T>;
  }

  return (repo ?? null) as NormalizedSandboxRepo<T>;
}

export async function loadOwnedSandboxRouteRecord<
  R extends SandboxRouteRecordLike,
>(
  request: Request,
  sandboxId: string,
  options: LoadSandboxRouteRecordOptions,
  overrides: Partial<SandboxRouteRecordLoaderDeps> = {}
): Promise<LoadedSandboxRouteRecord<R> | SandboxRouteFailure> {
  const deps: SandboxRouteRecordLoaderDeps = {
    ...defaultSandboxRouteRecordLoaderDeps,
    ...overrides,
  };

  let auth: SandboxServiceCredentials | null;
  try {
    auth = await deps.getSandboxServiceCredentials(request, {
      allowInternal: true,
      teamId: readActiveTeamIdHeader(request),
      auditTargetId: sandboxId,
      requireCapability: options.requireCapability,
    });
  } catch (error) {
    if (isSandboxCapabilityDeniedError(error)) {
      return { ok: false, status: error.status, error: error.message };
    }
    throw error;
  }
  if (!auth) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized",
    };
  }

  const record = (await deps.loadOwnedSandboxRecord(
    sandboxId,
    auth.userId,
    options.select
  )) as R | null;
  if (!record) {
    return {
      ok: false,
      status: 404,
      error: options.notFoundMessage ?? "Not found",
    };
  }

  const repo = normalizeRouteRepo(record.repo);

  // Resolve the working subdirectory for this route operation:
  //
  //   sandbox.root_directory === undefined  → SELECT didn't include the
  //                                            field (legacy code path);
  //                                            fall back to repo default.
  //   sandbox.root_directory === null       → explicit "repo root" launch
  //                                            override; treat as no
  //                                            subdirectory regardless of
  //                                            the repo's persistent
  //                                            default.
  //   sandbox.root_directory is a string    → use that path verbatim.
  //
  // The migration 20260425030000_sandbox_root_directory.sql backfilled
  // every existing row, so post-migration NULL means "explicitly repo
  // root" rather than "missing value". Only the legacy SELECT case
  // legitimately falls back to the repo default here.
  // SandboxRouteRecordLike now declares `root_directory?: string | null`,
  // so this access is type-safe without a cast.
  const sandboxRootField = record.root_directory;

  let rootDirectory: string | null | undefined;
  if (sandboxRootField === undefined) {
    // Legacy SELECT — fall back to repo default.
    rootDirectory =
      normalizeRootDirectory(
        (repo as { root_directory?: string | null } | null)?.root_directory
      ) ?? undefined;
  } else if (sandboxRootField === null) {
    // Explicit "repo root" launch override — preserve null so callers
    // that distinguish "explicit override" from "missing data" can.
    rootDirectory = null;
  } else {
    // Subdirectory string. normalizeRootDirectory may collapse it back
    // to null if the stored value somehow degenerated (defensive); when
    // that happens, treat it the same as an explicit repo root.
    rootDirectory = normalizeRootDirectory(sandboxRootField) ?? null;
  }

  return {
    ok: true,
    auth,
    record,
    repo: repo as NormalizedSandboxRepo<R["repo"]>,
    rootDirectory,
  };
}

export async function resolveLoadedSandboxRouteContext<
  R extends SandboxRouteRecordLike,
>(
  loaded: LoadedSandboxRouteRecord<R>,
  options: Pick<
    LoadSandboxRouteContextOptions,
    "includeAi" | "hydrateSandboxClient"
  > = {},
  overrides: Partial<SandboxRouteContextLoaderDeps> = {}
): Promise<LoadedSandboxRouteContext<R> | SandboxRouteFailure> {
  const deps: SandboxRouteContextLoaderDeps = {
    ...defaultSandboxRouteContextLoaderDeps,
    ...overrides,
  };

  const contextResult = await deps.resolveSandboxRecordContext({
    sandboxCredentials: loaded.auth,
    record: loaded.record as Parameters<
      typeof resolveSandboxRecordContext
    >[0]["record"],
    includeAi: Boolean(options.includeAi),
  });
  if (!contextResult.ok) {
    return {
      ok: false,
      status: contextResult.status,
      error: contextResult.error,
    };
  }

  let sandbox: Sandbox | null = null;
  if (
    (options.hydrateSandboxClient ?? true) &&
    loaded.record.sandbox_id !== "pending"
  ) {
    try {
      sandbox = await deps.getSandbox(loaded.record.sandbox_id, {
        vercelToken: contextResult.context.credentials.vercelToken,
        vercelTeamId: contextResult.context.credentials.vercelTeamId,
        vercelProjectId: contextResult.context.credentials.vercelProjectId,
      });
    } catch (error) {
      return {
        ok: false,
        status: 500,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load sandbox client",
      };
    }
  }

  return {
    ...loaded,
    context: contextResult.context,
    sandbox,
  };
}

export async function loadOwnedSandboxRouteContext<
  R extends SandboxRouteRecordLike,
>(
  request: Request,
  sandboxId: string,
  options: LoadSandboxRouteContextOptions,
  overrides: Partial<
    SandboxRouteRecordLoaderDeps & SandboxRouteContextLoaderDeps
  > = {}
): Promise<LoadedSandboxRouteContext<R> | SandboxRouteFailure> {
  const loaded = await loadOwnedSandboxRouteRecord<R>(
    request,
    sandboxId,
    options,
    overrides
  );
  if (!loaded.ok) {
    return loaded;
  }

  return resolveLoadedSandboxRouteContext(loaded, options, overrides);
}

export function buildSandboxRouteErrorResponse(result: SandboxRouteFailure) {
  return NextResponse.json({ error: result.error }, { status: result.status });
}

/**
 * Capability-gated credentials fetch for sandbox routes that don't go
 * through `loadOwnedSandboxRouteRecord` (the few that call
 * `getSandboxServiceCredentials` directly to override `deps` downstream).
 * Returns a `SandboxRouteFailure` on auth or capability denial so callers
 * can pipe it into `buildSandboxRouteErrorResponse` like the record loaders.
 */
