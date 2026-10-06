import {
  normalizeEnvSyncMode,
  resolveEffectiveEnvSyncMode,
} from "@/lib/repo-settings";
import {
  resolveEffectiveSandboxBillingMode,
  normalizeRepoSandboxBillingModeOverride,
  normalizeSandboxBillingMode,
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
      error:
        | "NO_LINKED_PROJECT"
        | "PERSONAL_VERCEL_REQUIRED"
        | "VERCEL_INTEGRATION_REQUIRED";
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
  return {
    billingMode: resolveEffectiveSandboxBillingMode(input),
    source: null,
    projectId: null,
    teamId: null,
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
  return {
    envSyncMode: resolveEffectiveEnvSyncMode(input?.envSyncModeInput),
    source: null,
    projectId: null,
    teamId: null,
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
  if (normalizeEnvSyncMode(input.envSyncModeInput) === "vercel-project") {
    return {
      ok: false,
      status: 501,
      error: "VERCEL_INTEGRATION_REQUIRED",
      message:
        "Vercel project environment import requires an API-capable Vercel integration and is not available with Sign in with Vercel.",
    };
  }

  return {
    ok: false,
    status: 501,
    error: "VERCEL_INTEGRATION_REQUIRED",
    message:
      "Vercel project environment management requires an API-capable Vercel integration and is not available with Sign in with Vercel.",
  };
}
