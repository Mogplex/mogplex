export type SandboxBillingMode = "platform" | "user_vercel_project";

export const DEFAULT_SANDBOX_BILLING_MODE: SandboxBillingMode = "platform";
export const INHERITED_WORKSPACE_TEAM_OPTION = "__workspace__";

export type RepoSandboxBillingModeOverride = SandboxBillingMode | null;

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeSandboxBillingMode(
  value: unknown,
  fallback: SandboxBillingMode = DEFAULT_SANDBOX_BILLING_MODE
): SandboxBillingMode {
  if (value === "user_vercel_project") return "user_vercel_project";
  if (value === "platform") return "platform";
  return fallback;
}

export function normalizeRepoSandboxBillingModeOverride(
  value: unknown
): RepoSandboxBillingModeOverride {
  if (value === "user_vercel_project") return "user_vercel_project";
  if (value === "platform") return "platform";
  return null;
}

export type SandboxBillingResolution =
  | {
      ok: true;
      billingSource: "platform";
      projectId: null;
      teamId: null;
      sourceScope: "platform";
    }
  | {
      ok: true;
      billingSource: "user_vercel_project";
      projectId: string;
      teamId: string | null;
      sourceScope: "repo" | "workspace" | "account";
    }
  | {
      ok: false;
      billingSource: "user_vercel_project";
      error: string;
    };

export function resolveEffectiveSandboxBillingMode(input?: {
  workspaceBillingModeInput?: unknown;
  repoBillingModeOverrideInput?: unknown;
}): SandboxBillingMode {
  const repoOverride = normalizeRepoSandboxBillingModeOverride(
    input?.repoBillingModeOverrideInput
  );
  const resolved =
    repoOverride ??
    normalizeSandboxBillingMode(input?.workspaceBillingModeInput);

  // Warn only on the server so legacy preferences can be found in logs.
  if (resolved === "user_vercel_project" && typeof window === "undefined") {
    console.warn(
      "[sandbox-billing] user_vercel_project is not implemented; forcing platform"
    );
  }

  // Stored legacy preferences never select credentials for new launches.
  return DEFAULT_SANDBOX_BILLING_MODE;
}

export function resolveSandboxBilling(_input?: {
  workspaceBillingModeInput?: unknown;
  repoBillingModeOverrideInput?: unknown;
  repoLinkedProjectId?: unknown;
  repoLinkedTeamId?: unknown;
  workspaceLinkedProjectId?: unknown;
  workspaceLinkedTeamId?: unknown;
  accountLinkedProjectId?: unknown;
  accountLinkedTeamId?: unknown;
}): SandboxBillingResolution {
  // Keep accepting the persisted preference shape for older callers. Existing
  // sandbox records retain their original credential ownership elsewhere.
  return {
    ok: true,
    billingSource: "platform",
    projectId: null,
    teamId: null,
    sourceScope: "platform",
  };
}

export function resolveRepoSandboxTeamSelection(input: {
  effectiveBillingMode: SandboxBillingMode;
  repoLinkedTeamId?: unknown;
  workspaceLinkedTeamId?: unknown;
  workspaceLinkedProjectId?: unknown;
}) {
  const repoLinkedTeamId = normalizeOptionalText(input.repoLinkedTeamId);
  const workspaceLinkedTeamId = normalizeOptionalText(
    input.workspaceLinkedTeamId
  );
  const workspaceLinkedProjectId = normalizeOptionalText(
    input.workspaceLinkedProjectId
  );

  if (repoLinkedTeamId) {
    return {
      selectedTeamValue: repoLinkedTeamId,
      teamScope: repoLinkedTeamId,
      usingWorkspaceTeam: false,
    };
  }

  if (
    input.effectiveBillingMode === "user_vercel_project" &&
    (workspaceLinkedProjectId || workspaceLinkedTeamId)
  ) {
    return {
      selectedTeamValue: INHERITED_WORKSPACE_TEAM_OPTION,
      teamScope: workspaceLinkedTeamId || "personal",
      usingWorkspaceTeam: true,
    };
  }

  return {
    selectedTeamValue: "personal",
    teamScope: "personal",
    usingWorkspaceTeam: false,
  };
}

export function resolveRepoLinkedTeamPersistence(input: {
  repoLinkedTeamId?: unknown;
  repoLinkedProjectId?: unknown;
  workspaceLinkedTeamId?: unknown;
  usingWorkspaceTeam: boolean;
}) {
  const repoLinkedTeamId = normalizeOptionalText(input.repoLinkedTeamId);
  const repoLinkedProjectId = normalizeOptionalText(input.repoLinkedProjectId);
  const workspaceLinkedTeamId = normalizeOptionalText(
    input.workspaceLinkedTeamId
  );

  if (!repoLinkedProjectId) {
    return repoLinkedTeamId;
  }

  if (repoLinkedTeamId) {
    return repoLinkedTeamId;
  }

  if (input.usingWorkspaceTeam) {
    return workspaceLinkedTeamId;
  }

  return null;
}
