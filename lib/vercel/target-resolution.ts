import { normalizeEnvSyncMode } from "@/lib/repo-settings";
import {
  resolveEffectiveSandboxBillingMode,
  normalizeRepoSandboxBillingModeOverride,
  normalizeSandboxBillingMode,
  resolveSandboxBilling,
} from "@/lib/sandbox/billing";
import type { SandboxBillingMode } from "@/lib/sandbox/billing";
import type { VercelAuthMode } from "@/lib/vercel/service";

export type VercelLinkedProjectSource = "repo" | "workspace" | "account" | null;

export type BillingLinkedProjectSelection = {
  billingMode: SandboxBillingMode;
  source: VercelLinkedProjectSource;
  projectId: string | null;
  teamId: string | null;
};

export type EnvSyncLinkedProjectSelection = {
  envSyncMode: ReturnType<typeof normalizeEnvSyncMode>;
  source: "repo" | null;
  projectId: string | null;
  teamId: string | null;
};

export type RepoEnvVarAccessResolution =
  | {
      ok: true;
      authMode: VercelAuthMode;
      projectId: string;
      teamId: string | null;
      selectionSource: "repo" | "workspace" | "account";
      reason: "env_sync" | "billing";
      vercelToken: string;
    }
  | {
      ok: false;
      status: number;
      error: "NO_LINKED_PROJECT" | "PERSONAL_VERCEL_REQUIRED";
      message: string;
    };

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveBillingLinkedProjectSelection(input?: {
  workspaceBillingModeInput?: unknown;
  repoBillingModeOverrideInput?: unknown;
  repoLinkedProjectId?: unknown;
  repoLinkedTeamId?: unknown;
  workspaceLinkedProjectId?: unknown;
  workspaceLinkedTeamId?: unknown;
  accountLinkedProjectId?: unknown;
  accountLinkedTeamId?: unknown;
}): BillingLinkedProjectSelection {
  const billingMode = resolveEffectiveSandboxBillingMode({
    workspaceBillingModeInput: input?.workspaceBillingModeInput,
    repoBillingModeOverrideInput: input?.repoBillingModeOverrideInput,
  });

  const resolution = resolveSandboxBilling({
    workspaceBillingModeInput: input?.workspaceBillingModeInput,
    repoBillingModeOverrideInput: input?.repoBillingModeOverrideInput,
    repoLinkedProjectId: input?.repoLinkedProjectId,
    repoLinkedTeamId: input?.repoLinkedTeamId,
    workspaceLinkedProjectId: input?.workspaceLinkedProjectId,
    workspaceLinkedTeamId: input?.workspaceLinkedTeamId,
    accountLinkedProjectId: input?.accountLinkedProjectId,
    accountLinkedTeamId: input?.accountLinkedTeamId,
  });

  if (!resolution.ok || resolution.billingSource !== "user_vercel_project") {
    return {
      billingMode,
      source: null,
      projectId: null,
      teamId: null,
    };
  }

  return {
    billingMode,
    source: resolution.sourceScope,
    projectId: resolution.projectId,
    teamId: resolution.teamId,
  };
}

export function resolveBillingLinkedProjectOwner(input?: {
  workspaceBillingModeInput?: unknown;
  repoBillingModeOverrideInput?: unknown;
  repoLinkedProjectId?: unknown;
  workspaceLinkedProjectId?: unknown;
  accountLinkedProjectId?: unknown;
}): VercelLinkedProjectSource {
  const repoOverride = normalizeRepoSandboxBillingModeOverride(
    input?.repoBillingModeOverrideInput
  );
  if (repoOverride === "user_vercel_project") {
    return "repo";
  }

  if (repoOverride === "platform") {
    return null;
  }

  const workspaceBillingMode = normalizeSandboxBillingMode(
    input?.workspaceBillingModeInput
  );
  if (workspaceBillingMode !== "user_vercel_project") {
    return null;
  }

  if (normalizeOptionalText(input?.repoLinkedProjectId)) {
    return "repo";
  }

  // Workspace owns the link if it has its own project, even when an
  // account default exists — workspace overrides account.
  if (normalizeOptionalText(input?.workspaceLinkedProjectId)) {
    return "workspace";
  }

  if (normalizeOptionalText(input?.accountLinkedProjectId)) {
    return "account";
  }

  // We get here only when workspaceBillingModeInput === "user_vercel_project"
  // (the workspace explicitly opted into user-billed sandboxes) yet no
  // project has been linked at repo/workspace/account level. Attributing the
  // missing-project state to the workspace row is correct in that case —
  // the workspace is the level that asked for user billing.
  //
  // Active call sites depending on this default:
  //   - app/api/sandbox/route.ts prepareSandboxLaunch — persists
  //     `missing_project` on the workspace when billing is set but no project
  //     is linked yet (covered by sandbox-route tests).
  //   - lib/vercel/reconciliation.ts reconcileStoredRepoVercelLink — only
  //     short-circuits on `linkOwner === "repo"`, so any non-"repo" value
  //     including this fallback works.
  //
  // New callers that have account-default credentials must pass
  // `accountLinkedProjectId` so attribution flows to "account" instead.
  return "workspace";
}

export function resolveEnvSyncLinkedProjectSelection(input?: {
  envSyncModeInput?: unknown;
  repoLinkedProjectId?: unknown;
  repoLinkedTeamId?: unknown;
}): EnvSyncLinkedProjectSelection {
  const envSyncMode = normalizeEnvSyncMode(input?.envSyncModeInput);
  if (envSyncMode !== "vercel-project") {
    return {
      envSyncMode,
      source: null,
      projectId: null,
      teamId: null,
    };
  }

  return {
    envSyncMode,
    source: "repo",
    projectId: normalizeOptionalText(input?.repoLinkedProjectId),
    teamId: normalizeOptionalText(input?.repoLinkedTeamId),
  };
}

export function resolveRepoEnvVarAccess(input: {
  envSyncModeInput?: unknown;
  repoLinkedProjectId?: unknown;
  repoLinkedTeamId?: unknown;
  workspaceBillingModeInput?: unknown;
  repoBillingModeOverrideInput?: unknown;
  workspaceLinkedProjectId?: unknown;
  workspaceLinkedTeamId?: unknown;
  accountLinkedProjectId?: unknown;
  accountLinkedTeamId?: unknown;
  personalVercelToken?: string | null;
  platformVercelToken?: string | null;
  platformVercelTeamId?: string | null;
  platformVercelProjectId?: string | null;
}): RepoEnvVarAccessResolution {
  const envSyncSelection = resolveEnvSyncLinkedProjectSelection({
    envSyncModeInput: input.envSyncModeInput,
    repoLinkedProjectId: input.repoLinkedProjectId,
    repoLinkedTeamId: input.repoLinkedTeamId,
  });

  if (envSyncSelection.envSyncMode === "vercel-project") {
    if (!envSyncSelection.projectId) {
      return {
        ok: false,
        status: 400,
        error: "NO_LINKED_PROJECT",
        message:
          "Link a repo-linked Vercel project to sync env vars from Vercel.",
      };
    }

    if (!input.personalVercelToken) {
      return {
        ok: false,
        status: 400,
        error: "PERSONAL_VERCEL_REQUIRED",
        message:
          "Link Personal Vercel to sync env vars from the repo-linked Vercel project.",
      };
    }

    return {
      ok: true,
      authMode: "personal",
      projectId: envSyncSelection.projectId,
      teamId: envSyncSelection.teamId,
      selectionSource: "repo",
      reason: "env_sync",
      vercelToken: input.personalVercelToken,
    };
  }

  const billingSelection = resolveBillingLinkedProjectSelection({
    workspaceBillingModeInput: input.workspaceBillingModeInput,
    repoBillingModeOverrideInput: input.repoBillingModeOverrideInput,
    repoLinkedProjectId: input.repoLinkedProjectId,
    repoLinkedTeamId: input.repoLinkedTeamId,
    workspaceLinkedProjectId: input.workspaceLinkedProjectId,
    workspaceLinkedTeamId: input.workspaceLinkedTeamId,
    accountLinkedProjectId: input.accountLinkedProjectId,
    accountLinkedTeamId: input.accountLinkedTeamId,
  });

  if (billingSelection.billingMode === "user_vercel_project") {
    if (!billingSelection.projectId) {
      return {
        ok: false,
        status: 400,
        error: "NO_LINKED_PROJECT",
        message:
          billingSelection.source === "workspace"
            ? "Select or create a workspace-linked Vercel project to access user-billed env vars."
            : billingSelection.source === "account"
              ? "Set a default Vercel billing project to access user-billed env vars."
              : "Select or create a repo-linked Vercel project to access user-billed env vars.",
      };
    }

    if (!input.personalVercelToken) {
      return {
        ok: false,
        status: 400,
        error: "PERSONAL_VERCEL_REQUIRED",
        message: "Link Personal Vercel to access the selected billing project.",
      };
    }

    if (billingSelection.source === null) {
      // Invariant: resolveBillingLinkedProjectSelection only returns source=null
      // when projectId is also null, and we already gated on !projectId above.
      // If we're here, something upstream is returning an unexpected shape.
      // Surface it instead of silently attributing the access to "repo".
      console.warn(
        "[vercel/target-resolution] billing selection source is null with non-null projectId",
        { projectId: billingSelection.projectId }
      );
    }

    return {
      ok: true,
      authMode: "personal",
      projectId: billingSelection.projectId,
      teamId: billingSelection.teamId,
      selectionSource: billingSelection.source ?? "repo",
      reason: "billing",
      vercelToken: input.personalVercelToken,
    };
  }

  return {
    ok: false,
    status: 400,
    error: "NO_LINKED_PROJECT",
    message:
      "Select or create a repo-linked or workspace-linked Vercel project, then link Personal Vercel to manage env vars. Platform-backed env var management is disabled.",
  };
}
