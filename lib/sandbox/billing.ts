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

  // Phase 1 kill-switch: when NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING=1,
  // ignore any workspace/repo selection of `user_vercel_project` and always
  // run on the platform Vercel account. NEXT_PUBLIC_ so the same flag is
  // visible to client bundles (settings-model.ts is consumed by client
  // components like workspace-dialog.tsx) — without that, the client would
  // render BYO-Vercel UI while the server silently downgrades launches.
  if (
    resolved === "user_vercel_project" &&
    process.env.NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING === "1"
  ) {
    // Warn only on the server so we can grep prod logs for stragglers
    // without spamming the browser console on every render.
    if (typeof window === "undefined") {
      console.warn(
        "[sandbox-billing] user_vercel_project requested but disabled; forcing platform"
      );
    }
    return "platform";
  }

  return resolved;
}

export function resolveSandboxBilling(input?: {
  workspaceBillingModeInput?: unknown;
  repoBillingModeOverrideInput?: unknown;
  repoLinkedProjectId?: unknown;
  repoLinkedTeamId?: unknown;
  workspaceLinkedProjectId?: unknown;
  workspaceLinkedTeamId?: unknown;
  accountLinkedProjectId?: unknown;
  accountLinkedTeamId?: unknown;
}): SandboxBillingResolution {
  const billingMode = resolveEffectiveSandboxBillingMode(input);
  if (billingMode === "platform") {
    return {
      ok: true,
      billingSource: "platform",
      projectId: null,
      teamId: null,
      sourceScope: "platform",
    };
  }

  const repoProjectId = normalizeOptionalText(input?.repoLinkedProjectId);
  const repoTeamId = normalizeOptionalText(input?.repoLinkedTeamId);
  const workspaceProjectId = normalizeOptionalText(
    input?.workspaceLinkedProjectId
  );
  const workspaceTeamId = normalizeOptionalText(input?.workspaceLinkedTeamId);
  const accountProjectId = normalizeOptionalText(input?.accountLinkedProjectId);
  const accountTeamId = normalizeOptionalText(input?.accountLinkedTeamId);

  if (repoProjectId) {
    return {
      ok: true,
      billingSource: "user_vercel_project",
      projectId: repoProjectId,
      teamId: repoTeamId,
      sourceScope: "repo",
    };
  }

  if (workspaceProjectId) {
    return {
      ok: true,
      billingSource: "user_vercel_project",
      projectId: workspaceProjectId,
      teamId: workspaceTeamId,
      sourceScope: "workspace",
    };
  }

  if (accountProjectId) {
    return {
      ok: true,
      billingSource: "user_vercel_project",
      projectId: accountProjectId,
      teamId: accountTeamId,
      sourceScope: "account",
    };
  }

  return {
    ok: false,
    billingSource: "user_vercel_project",
    error: "Select or create a Vercel project for user-owned sandbox billing.",
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
