import { loadUserVercelCredentials } from "@/lib/sandbox/get-user-credentials";
import { resolveEffectiveSandboxBillingMode } from "@/lib/sandbox/billing";
import {
  resolveBillingLinkedProjectOwner,
  resolveBillingLinkedProjectSelection,
} from "@/lib/vercel/target-resolution";
import { validateVercelProjectAccess } from "@/lib/vercel/service";
import {
  derivePersistedVercelLinkedProjectValidation,
  deriveVercelLinkedProjectValidation,
} from "@/lib/vercel/validation";
import type { VercelServiceErrorCode } from "@/lib/vercel/service";
import type {
  PersistedVercelLinkErrorCode,
  PersistedVercelLinkStatus,
  VercelLinkedProjectValidationSource,
} from "@/lib/vercel/validation";

export type PersistedVercelLinkState = {
  vercel_link_status: PersistedVercelLinkStatus;
  vercel_link_checked_at: string | null;
  vercel_link_error_code: PersistedVercelLinkErrorCode | null;
  vercel_link_message: string | null;
};

export type WorkspaceVercelLinkRecord = {
  id: string;
  user_id: string;
  sandbox_billing_mode?: unknown;
  sandbox_vercel_project_id?: string | null;
  sandbox_vercel_team_id?: string | null;
};

export type RepoVercelLinkRecord = {
  id: string;
  user_id: string;
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

type ReconciliationDeps = {
  loadUserVercelCredentials: typeof loadUserVercelCredentials;
  validateVercelProjectAccess: typeof validateVercelProjectAccess;
  now: () => string;
};

const defaultDeps: ReconciliationDeps = {
  loadUserVercelCredentials,
  validateVercelProjectAccess,
  now: () => new Date().toISOString(),
};

export type ReconciledVercelLink =
  | {
      outcome: "updated";
      state: PersistedVercelLinkState;
    }
  | {
      outcome: "failed";
      reason: string;
    };

function toWorkspace(record: RepoVercelLinkRecord["workspace"]) {
  return Array.isArray(record) ? record[0] : record;
}

export function buildUnknownVercelLinkState(): PersistedVercelLinkState {
  return {
    vercel_link_status: "unknown",
    vercel_link_checked_at: null,
    vercel_link_error_code: null,
    vercel_link_message: null,
  };
}

export function shouldResetWorkspaceVercelLinkState(
  body: Record<string, unknown>
) {
  return (
    "sandbox_billing_mode" in body ||
    "sandbox_vercel_project_id" in body ||
    "sandbox_vercel_team_id" in body
  );
}

export function shouldResetRepoVercelLinkState(body: Record<string, unknown>) {
  return (
    "sandbox_billing_mode_override" in body ||
    "vercel_project_id" in body ||
    "vercel_team_id" in body
  );
}

export function buildPersistedVercelLinkStateFromValidation(input: {
  source: VercelLinkedProjectValidationSource;
  billingMode: "platform" | "user_vercel_project";
  projectId?: string | null;
  personalState: "linked" | "not_linked";
  access:
    | { ok: true }
    | {
        ok: false;
        code:
          | "AUTH_INVALID"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_FORBIDDEN"
          | "TEAM_FORBIDDEN";
      }
    | null;
  checkedAt: string;
}): PersistedVercelLinkState {
  const validation = deriveVercelLinkedProjectValidation({
    billingMode: input.billingMode,
    source: input.source,
    projectId: input.projectId ?? null,
    personalState: input.personalState,
    access: input.access,
  });

  const persistedStatus: PersistedVercelLinkStatus =
    validation?.state && validation.state !== "none"
      ? validation.state
      : "unknown";
  const derivedErrorCode: PersistedVercelLinkErrorCode | null =
    input.personalState === "not_linked"
      ? "PERSONAL_VERCEL_NOT_LINKED"
      : input.access && !input.access.ok
        ? input.access.code
        : persistedStatus === "missing_project"
          ? "MISSING_PROJECT"
          : null;

  const persisted = derivePersistedVercelLinkedProjectValidation({
    status: persistedStatus,
    source: input.source,
    message: validation?.message ?? null,
    errorCode: derivedErrorCode,
  });

  return {
    vercel_link_status: persistedStatus,
    vercel_link_checked_at: persisted ? input.checkedAt : null,
    vercel_link_error_code: derivedErrorCode,
    vercel_link_message: persisted?.message ?? null,
  };
}

function isPersistableAccessCode(
  code: VercelServiceErrorCode
): code is
  | "AUTH_INVALID"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_FORBIDDEN"
  | "TEAM_FORBIDDEN" {
  return (
    code === "AUTH_INVALID" ||
    code === "PROJECT_NOT_FOUND" ||
    code === "PROJECT_FORBIDDEN" ||
    code === "TEAM_FORBIDDEN"
  );
}

export async function reconcileStoredWorkspaceVercelLink(
  workspace: WorkspaceVercelLinkRecord,
  overrides: Partial<ReconciliationDeps> = {}
): Promise<ReconciledVercelLink> {
  const deps = { ...defaultDeps, ...overrides };

  if (
    resolveEffectiveSandboxBillingMode({
      workspaceBillingModeInput: workspace.sandbox_billing_mode,
    }) !== "user_vercel_project"
  ) {
    return { outcome: "updated", state: buildUnknownVercelLinkState() };
  }

  const checkedAt = deps.now();
  const projectId = workspace.sandbox_vercel_project_id ?? null;
  const teamId = workspace.sandbox_vercel_team_id ?? null;

  if (!projectId) {
    return {
      outcome: "updated",
      state: buildPersistedVercelLinkStateFromValidation({
        source: "workspace",
        billingMode: "user_vercel_project",
        projectId: null,
        personalState: "linked",
        access: null,
        checkedAt,
      }),
    };
  }

  const creds = await deps.loadUserVercelCredentials(workspace.user_id);
  if (!creds.userVercelToken) {
    return {
      outcome: "updated",
      state: buildPersistedVercelLinkStateFromValidation({
        source: "workspace",
        billingMode: "user_vercel_project",
        projectId,
        personalState: "not_linked",
        access: null,
        checkedAt,
      }),
    };
  }

  const access = await deps.validateVercelProjectAccess({
    authMode: "personal",
    vercelToken: creds.userVercelToken,
    teamId,
    projectId,
  });

  if (!access.ok && !isPersistableAccessCode(access.error.code)) {
    return {
      outcome: "failed",
      reason: access.error.message,
    };
  }

  const persistedAccess = access.ok
    ? ({ ok: true } as const)
    : (() => {
        const { code } = access.error;
        if (!isPersistableAccessCode(code)) {
          throw new Error("Unreachable persisted access state");
        }
        return { ok: false as const, code };
      })();

  return {
    outcome: "updated",
    state: buildPersistedVercelLinkStateFromValidation({
      source: "workspace",
      billingMode: "user_vercel_project",
      projectId,
      personalState: "linked",
      access: persistedAccess,
      checkedAt,
    }),
  };
}

export async function reconcileStoredRepoVercelLink(
  repo: RepoVercelLinkRecord,
  overrides: Partial<ReconciliationDeps> = {}
): Promise<ReconciledVercelLink> {
  const deps = { ...defaultDeps, ...overrides };
  const workspace = toWorkspace(repo.workspace);
  const linkOwner = resolveBillingLinkedProjectOwner({
    workspaceBillingModeInput: workspace?.sandbox_billing_mode,
    repoBillingModeOverrideInput: repo.sandbox_billing_mode_override,
    repoLinkedProjectId: repo.vercel_project_id,
  });
  const linkedProject = resolveBillingLinkedProjectSelection({
    workspaceBillingModeInput: workspace?.sandbox_billing_mode,
    repoBillingModeOverrideInput: repo.sandbox_billing_mode_override,
    repoLinkedProjectId: repo.vercel_project_id,
    repoLinkedTeamId: repo.vercel_team_id,
    workspaceLinkedProjectId: workspace?.sandbox_vercel_project_id,
    workspaceLinkedTeamId: workspace?.sandbox_vercel_team_id,
  });

  if (
    linkedProject.billingMode !== "user_vercel_project" ||
    linkOwner !== "repo"
  ) {
    return { outcome: "updated", state: buildUnknownVercelLinkState() };
  }

  const checkedAt = deps.now();
  const projectId = repo.vercel_project_id ?? null;
  const teamId = repo.vercel_team_id ?? null;

  if (!projectId) {
    return {
      outcome: "updated",
      state: buildPersistedVercelLinkStateFromValidation({
        source: "repo",
        billingMode: "user_vercel_project",
        projectId: null,
        personalState: "linked",
        access: null,
        checkedAt,
      }),
    };
  }

  const creds = await deps.loadUserVercelCredentials(repo.user_id);
  if (!creds.userVercelToken) {
    return {
      outcome: "updated",
      state: buildPersistedVercelLinkStateFromValidation({
        source: "repo",
        billingMode: "user_vercel_project",
        projectId,
        personalState: "not_linked",
        access: null,
        checkedAt,
      }),
    };
  }

  const access = await deps.validateVercelProjectAccess({
    authMode: "personal",
    vercelToken: creds.userVercelToken,
    teamId,
    projectId,
  });

  if (!access.ok && !isPersistableAccessCode(access.error.code)) {
    return {
      outcome: "failed",
      reason: access.error.message,
    };
  }

  const persistedAccess = access.ok
    ? ({ ok: true } as const)
    : (() => {
        const { code } = access.error;
        if (!isPersistableAccessCode(code)) {
          throw new Error("Unreachable persisted access state");
        }
        return { ok: false as const, code };
      })();

  return {
    outcome: "updated",
    state: buildPersistedVercelLinkStateFromValidation({
      source: "repo",
      billingMode: "user_vercel_project",
      projectId,
      personalState: "linked",
      access: persistedAccess,
      checkedAt,
    }),
  };
}
