import {
  buildSandboxAiNetworkPolicy,
  buildSandboxHarnessAiEnv,
  buildSandboxTerminalAiEnv,
  buildSandboxTerminalShellAiEnv,
  resolveSandboxAiAccess,
} from "@/lib/sandbox/ai-runtime";
import {
  resolveSandboxRecordCredentials,
  resolveSandboxTarget,
  resolveSandboxTargetCredentials,
} from "@/lib/sandbox/get-user-credentials";
import type {
  SandboxAiBillingSource,
  SandboxAiAccess,
} from "@/lib/sandbox/ai-runtime";
import type { HarnessId } from "@/lib/harness/config";
import type { SandboxBillingMode } from "@/lib/sandbox/billing";
import type {
  SandboxCredentialSource,
  SandboxServiceCredentials,
} from "@/lib/sandbox/get-user-credentials";

type SandboxContextDeps = {
  resolveSandboxAiAccess: typeof resolveSandboxAiAccess;
};

const defaultSandboxContextDeps: SandboxContextDeps = {
  resolveSandboxAiAccess,
};

type SandboxCredentialLike = Pick<
  SandboxServiceCredentials,
  | "vercelToken"
  | "vercelTeamId"
  | "vercelProjectId"
  | "allowPlatformSandbox"
  | "userVercelToken"
  | "userVercelTeamId"
  | "accountDefaultVercelProjectId"
  | "accountDefaultVercelTeamId"
> & {
  userId?: string | null;
};

type SandboxResolvedCredentials = {
  vercelToken: string;
  vercelTeamId: string | null;
  vercelProjectId: string;
};

export type SandboxOwnershipContext = {
  source: "config" | "record";
  billingSource: SandboxBillingMode;
  credentialSource: SandboxCredentialSource;
  projectId: string;
  teamId: string | null;
};

export type SandboxAiContext = {
  aiBillingSource: SandboxAiBillingSource | null;
  terminalEnv: Record<string, string>;
  terminalShellEnv: Record<string, string>;
  networkPolicy: ReturnType<typeof buildSandboxAiNetworkPolicy>;
  buildHarnessEnv: (
    harnessId: HarnessId
  ) => ReturnType<typeof buildSandboxHarnessAiEnv>;
};

export type SandboxVercelContext = {
  ownership: SandboxOwnershipContext;
  credentials: SandboxResolvedCredentials;
};

export type SandboxExecutionContext = SandboxVercelContext & {
  ai: SandboxAiContext;
};

type SandboxContextFailure = {
  ok: false;
  error: string;
  status: 400 | 403 | 500;
  billingSource?: SandboxBillingMode;
  credentialSource?: SandboxCredentialSource;
};

type SandboxContextSuccess<T> = {
  ok: true;
  context: T;
};

export type SandboxContextResult<T> =
  | SandboxContextSuccess<T>
  | SandboxContextFailure;

type SandboxCreateContextInput = {
  sandboxCredentials: SandboxServiceCredentials;
  workspaceBillingModeInput?: unknown;
  repoBillingModeOverrideInput?: unknown;
  repoLinkedProjectId?: unknown;
  repoLinkedTeamId?: unknown;
  workspaceLinkedProjectId?: unknown;
  workspaceLinkedTeamId?: unknown;
  accountLinkedProjectId?: unknown;
  accountLinkedTeamId?: unknown;
  includeAi?: boolean;
};

type SandboxRecordLike = {
  billing_source?: string | null;
  billing_project_id?: string | null;
  billing_team_id?: string | null;
  vercel_project_id?: string | null;
  vercel_team_id?: string | null;
};

type SandboxRecordContextInput = {
  sandboxCredentials: SandboxCredentialLike;
  record: SandboxRecordLike;
  includeAi?: boolean;
};

type SnapshotContextRepoLike = {
  snapshot_billing_source?: string | null;
  snapshot_billing_project_id?: string | null;
  snapshot_billing_team_id?: string | null;
  sandbox_billing_mode_override?: unknown;
  vercel_project_id?: string | null;
  vercel_team_id?: string | null;
  workspace?:
    | {
        sandbox_billing_mode?: unknown;
        sandbox_vercel_project_id?: string | null;
        sandbox_vercel_team_id?: string | null;
      }
    | Array<{
        sandbox_billing_mode?: unknown;
        sandbox_vercel_project_id?: string | null;
        sandbox_vercel_team_id?: string | null;
      }>
    | null;
};

type SnapshotContextInput = {
  sandboxCredentials: SandboxCredentialLike;
  repo: SnapshotContextRepoLike;
};

function buildAiContext(access: SandboxAiAccess): SandboxAiContext {
  const terminal = buildSandboxTerminalAiEnv(access);
  const terminalShell = buildSandboxTerminalShellAiEnv(access);
  return {
    aiBillingSource: terminal.aiBillingSource,
    terminalEnv: terminal.env,
    terminalShellEnv: terminalShell.env,
    networkPolicy: buildSandboxAiNetworkPolicy(access),
    buildHarnessEnv(harnessId) {
      return buildSandboxHarnessAiEnv(access, harnessId);
    },
  };
}

async function maybeResolveAiContext(
  sandboxCredentials: SandboxCredentialLike,
  includeAi: boolean,
  deps: SandboxContextDeps
): Promise<SandboxContextResult<SandboxAiContext | null>> {
  if (!includeAi) {
    return { ok: true, context: null };
  }

  if (!sandboxCredentials.userId) {
    return {
      ok: false,
      error: "Missing user context for sandbox AI resolution.",
      status: 500,
    };
  }

  const access = await deps.resolveSandboxAiAccess(sandboxCredentials.userId);
  return {
    ok: true,
    context: buildAiContext(access),
  };
}

function buildVercelContext(
  input: {
    source: "config" | "record";
    billingSource: SandboxBillingMode;
    credentialSource: SandboxCredentialSource;
  },
  credentials: SandboxResolvedCredentials
): SandboxVercelContext {
  return {
    ownership: {
      source: input.source,
      billingSource: input.billingSource,
      credentialSource: input.credentialSource,
      projectId: credentials.vercelProjectId,
      teamId: credentials.vercelTeamId,
    },
    credentials,
  };
}

function mergeExecutionContext(
  base: SandboxVercelContext,
  ai: SandboxAiContext | null
): SandboxVercelContext | SandboxExecutionContext {
  if (!ai) return base;
  return {
    ...base,
    ai,
  };
}

export async function resolveSandboxCreateContext(
  input: SandboxCreateContextInput,
  overrides: Partial<SandboxContextDeps> = {}
): Promise<
  SandboxContextResult<SandboxVercelContext | SandboxExecutionContext>
> {
  const deps: SandboxContextDeps = {
    ...defaultSandboxContextDeps,
    ...overrides,
  };

  const target = resolveSandboxTarget({
    workspaceBillingModeInput: input.workspaceBillingModeInput,
    repoBillingModeOverrideInput: input.repoBillingModeOverrideInput,
    repoLinkedProjectId: input.repoLinkedProjectId,
    repoLinkedTeamId: input.repoLinkedTeamId,
    workspaceLinkedProjectId: input.workspaceLinkedProjectId,
    workspaceLinkedTeamId: input.workspaceLinkedTeamId,
    accountLinkedProjectId:
      input.accountLinkedProjectId ??
      input.sandboxCredentials.accountDefaultVercelProjectId,
    accountLinkedTeamId:
      input.accountLinkedTeamId ??
      input.sandboxCredentials.accountDefaultVercelTeamId,
  });

  if (!target.ok) {
    return {
      ok: false,
      error: target.error,
      status: 400,
      billingSource: target.billingSource,
    };
  }

  const resolvedCredentials = resolveSandboxTargetCredentials(
    input.sandboxCredentials,
    target
  );
  if (!resolvedCredentials.ok) {
    return {
      ok: false,
      error: resolvedCredentials.error,
      status: resolvedCredentials.status,
      billingSource: target.billingSource,
      credentialSource: target.credentialSource,
    };
  }

  const aiResult = await maybeResolveAiContext(
    input.sandboxCredentials,
    Boolean(input.includeAi),
    deps
  );
  if (!aiResult.ok) return aiResult;

  const baseContext = buildVercelContext(
    {
      source: "config",
      billingSource: target.billingSource,
      credentialSource: target.credentialSource,
    },
    {
      vercelToken: resolvedCredentials.vercelToken,
      vercelTeamId: resolvedCredentials.vercelTeamId ?? null,
      vercelProjectId: resolvedCredentials.vercelProjectId,
    }
  );

  return {
    ok: true,
    context: mergeExecutionContext(baseContext, aiResult.context),
  };
}

function inferRecordBillingSource(
  record: SandboxRecordLike
): SandboxBillingMode {
  return record.billing_source === "user_vercel_project"
    ? "user_vercel_project"
    : "platform";
}

function inferRecordCredentialSource(
  record: SandboxRecordLike
): SandboxCredentialSource {
  return inferRecordBillingSource(record) === "user_vercel_project"
    ? "user"
    : "platform";
}

export async function resolveSandboxRecordContext(
  input: SandboxRecordContextInput,
  overrides: Partial<SandboxContextDeps> = {}
): Promise<
  SandboxContextResult<SandboxVercelContext | SandboxExecutionContext>
> {
  const deps: SandboxContextDeps = {
    ...defaultSandboxContextDeps,
    ...overrides,
  };

  const resolvedCredentials = resolveSandboxRecordCredentials(
    input.sandboxCredentials,
    input.record
  );
  if (!resolvedCredentials.ok) {
    return {
      ok: false,
      error: resolvedCredentials.error,
      status: resolvedCredentials.status,
      billingSource: inferRecordBillingSource(input.record),
      credentialSource: inferRecordCredentialSource(input.record),
    };
  }

  const aiResult = await maybeResolveAiContext(
    input.sandboxCredentials,
    Boolean(input.includeAi),
    deps
  );
  if (!aiResult.ok) return aiResult;

  const baseContext = buildVercelContext(
    {
      source: "record",
      billingSource: inferRecordBillingSource(input.record),
      credentialSource: inferRecordCredentialSource(input.record),
    },
    {
      vercelToken: resolvedCredentials.vercelToken,
      vercelTeamId: resolvedCredentials.vercelTeamId ?? null,
      vercelProjectId: resolvedCredentials.vercelProjectId,
    }
  );

  return {
    ok: true,
    context: mergeExecutionContext(baseContext, aiResult.context),
  };
}

export async function resolveSnapshotContext(
  input: SnapshotContextInput,
  overrides: Partial<SandboxContextDeps> = {}
): Promise<SandboxContextResult<SandboxVercelContext>> {
  const hasStoredSnapshotOwnership = Boolean(
    input.repo.snapshot_billing_source ||
    input.repo.snapshot_billing_project_id ||
    input.repo.snapshot_billing_team_id
  );

  if (hasStoredSnapshotOwnership) {
    const recordResult = await resolveSandboxRecordContext(
      {
        sandboxCredentials: input.sandboxCredentials,
        record: {
          billing_source: input.repo.snapshot_billing_source,
          billing_project_id: input.repo.snapshot_billing_project_id,
          billing_team_id: input.repo.snapshot_billing_team_id,
          vercel_project_id: null,
          vercel_team_id: null,
        },
        includeAi: false,
      },
      overrides
    );

    return recordResult.ok
      ? { ok: true, context: recordResult.context }
      : recordResult;
  }

  const workspace = Array.isArray(input.repo.workspace)
    ? input.repo.workspace[0]
    : input.repo.workspace;
  return resolveSandboxCreateContext(
    {
      sandboxCredentials: input.sandboxCredentials as SandboxServiceCredentials,
      workspaceBillingModeInput: workspace?.sandbox_billing_mode,
      repoBillingModeOverrideInput: input.repo.sandbox_billing_mode_override,
      repoLinkedProjectId: input.repo.vercel_project_id,
      repoLinkedTeamId: input.repo.vercel_team_id,
      workspaceLinkedProjectId: workspace?.sandbox_vercel_project_id,
      workspaceLinkedTeamId: workspace?.sandbox_vercel_team_id,
      accountLinkedProjectId:
        input.sandboxCredentials.accountDefaultVercelProjectId,
      accountLinkedTeamId: input.sandboxCredentials.accountDefaultVercelTeamId,
      includeAi: false,
    },
    overrides
  );
}
