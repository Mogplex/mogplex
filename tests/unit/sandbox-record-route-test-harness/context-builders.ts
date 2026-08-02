import {
  defaultSandboxAuth,
  defaultSandboxCredentials,
  defaultSandboxHealthRecord,
  defaultSandboxRepo,
  defaultSandboxTerminalProxy,
  defaultSandboxTerminalProxyRecord,
  defaultSandboxTerminalRecord,
  defaultSandboxTerminalRepo,
  type BuildLoadedSandboxHealthRouteContextOptions,
  type BuildLoadedSandboxTerminalRouteContextOptions,
  type BuildLoadedValidatedTerminalProxyRequestOptions,
  type SandboxAuthFixture,
  type SandboxCredentialsFixture,
  type SandboxHealthRecordFixture,
  type SandboxOwnershipFixture,
  type SandboxRouteRepoFixture,
  type SandboxTerminalProxyFixture,
  type SandboxTerminalProxyRecordFixture,
  type SandboxTerminalRecordFixture,
} from "./shared";

function pickDerivedRepo(
  repo: SandboxRouteRepoFixture | null | undefined,
  recordRepo:
    | SandboxRouteRepoFixture
    | SandboxRouteRepoFixture[]
    | null
    | undefined,
  fallbackRepo: SandboxRouteRepoFixture
) {
  if (repo !== undefined) return repo;

  if (Array.isArray(recordRepo)) return recordRepo[0] ?? { ...fallbackRepo };

  return recordRepo ?? { ...fallbackRepo };
}

function buildMergedSandboxAuth(auth: Partial<SandboxAuthFixture>) {
  return {
    ...defaultSandboxAuth,
    ...auth,
  } satisfies SandboxAuthFixture;
}

function buildMergedSandboxCredentials(
  auth: SandboxAuthFixture,
  credentials: Partial<SandboxCredentialsFixture>
) {
  return {
    vercelToken: auth.vercelToken,
    vercelTeamId: auth.vercelTeamId,
    vercelProjectId: auth.vercelProjectId,
    ...credentials,
  } satisfies SandboxCredentialsFixture;
}

function buildHealthRouteOwnership(
  record: SandboxHealthRecordFixture,
  auth: SandboxAuthFixture,
  ownership: Partial<SandboxOwnershipFixture>
) {
  return {
    source: "record",
    billingSource: record.billing_source,
    credentialSource: auth.userVercelToken ? "user" : "platform",
    projectId: record.vercel_project_id ?? record.billing_project_id,
    teamId: record.vercel_team_id ?? record.billing_team_id,
    ...ownership,
  } satisfies SandboxOwnershipFixture;
}

function resolveHealthRouteSandbox(
  sandbox: Record<string, unknown> | null | undefined,
  record: SandboxHealthRecordFixture
) {
  if (sandbox !== undefined) return sandbox;
  if (record.sandbox_id === "pending") return null;
  return { id: record.sandbox_id };
}

function resolveTerminalRouteSandbox(
  sandbox: Record<string, unknown> | null | undefined,
  record: SandboxTerminalRecordFixture
) {
  if (sandbox !== undefined) return sandbox;
  if (record.sandbox_id === "pending") return null;
  return { sandboxId: record.sandbox_id };
}

export function buildLoadedSandboxHealthRouteContext({
  auth = {},
  record = {},
  repo,
  rootDirectory,
  ownership = {},
  credentials = {},
  sandbox,
}: BuildLoadedSandboxHealthRouteContextOptions = {}) {
  const mergedAuth = buildMergedSandboxAuth(auth);
  const derivedRepo = pickDerivedRepo(repo, record.repo, defaultSandboxRepo);
  const mergedRecord: SandboxHealthRecordFixture = {
    ...defaultSandboxHealthRecord,
    ...record,
    repo: record.repo ?? derivedRepo,
  };
  const mergedCredentials = buildMergedSandboxCredentials(
    mergedAuth,
    credentials
  );
  const mergedOwnership = buildHealthRouteOwnership(
    mergedRecord,
    mergedAuth,
    ownership
  );

  return {
    ok: true as const,
    auth: mergedAuth,
    record: mergedRecord,
    repo: derivedRepo,
    rootDirectory,
    context: {
      ownership: mergedOwnership,
      credentials: mergedCredentials,
    },
    sandbox: resolveHealthRouteSandbox(sandbox, mergedRecord),
  };
}

export function buildLoadedSandboxTerminalRouteContext({
  auth = {},
  record = {},
  repo,
  rootDirectory,
  credentials = {},
  sandbox,
}: BuildLoadedSandboxTerminalRouteContextOptions = {}) {
  const mergedAuth = buildMergedSandboxAuth(auth);
  const derivedRepo = pickDerivedRepo(
    repo,
    record.repo,
    defaultSandboxTerminalRepo
  );
  const mergedRecord: SandboxTerminalRecordFixture = {
    ...defaultSandboxTerminalRecord,
    ...record,
    repo: record.repo ?? derivedRepo,
  };
  const mergedCredentials = buildMergedSandboxCredentials(
    mergedAuth,
    credentials
  );

  return {
    ok: true as const,
    auth: mergedAuth,
    repo: derivedRepo,
    rootDirectory: rootDirectory ?? derivedRepo?.root_directory ?? undefined,
    record: mergedRecord,
    context: {
      credentials: mergedCredentials,
    },
    sandbox: resolveTerminalRouteSandbox(sandbox, mergedRecord),
  };
}

export function buildLoadedValidatedTerminalProxyRequest({
  auth = {},
  record = {},
  proxy = {},
  bridgeToken = "bridge-token",
  repo = null,
  rootDirectory,
}: BuildLoadedValidatedTerminalProxyRequestOptions = {}) {
  const mergedAuth: SandboxAuthFixture = {
    ...defaultSandboxAuth,
    ...auth,
  };
  const mergedRecord: SandboxTerminalProxyRecordFixture = {
    ...defaultSandboxTerminalProxyRecord,
    ...record,
  };
  const mergedProxy: SandboxTerminalProxyFixture = {
    ...defaultSandboxTerminalProxy,
    recordId: mergedRecord.id,
    sandboxRuntimeId: mergedRecord.sandbox_id,
    ...proxy,
  };

  return {
    ok: true as const,
    loaded: {
      ok: true as const,
      auth: mergedAuth,
      record: mergedRecord,
      repo,
      rootDirectory,
    },
    proxy: mergedProxy,
    bridgeToken,
  };
}

export function buildResolvedSandboxRouteContext<TLoaded extends object>(
  loaded: TLoaded,
  overrides: Record<string, unknown> = {}
) {
  return {
    ...loaded,
    ok: true as const,
    context: {
      credentials: { ...defaultSandboxCredentials },
    },
    sandbox: null,
    ...overrides,
  };
}

export function buildSandboxRouteContextFailure({
  status = 400,
  error = "Linked Vercel project missing",
}: {
  status?: number;
  error?: string;
} = {}) {
  return {
    ok: false as const,
    status,
    error,
  };
}
