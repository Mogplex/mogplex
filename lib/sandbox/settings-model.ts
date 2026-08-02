import {
  INHERITED_WORKSPACE_TEAM_OPTION,
  resolveEffectiveSandboxBillingMode,
  resolveRepoLinkedTeamPersistence,
  resolveRepoSandboxTeamSelection,
} from "@/lib/sandbox/billing";
import { resolveBillingLinkedProjectSelection } from "@/lib/vercel/target-resolution";
import {
  DEFAULT_SANDBOX_IDLE_TIMEOUT_MS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "@/lib/repo-settings";
import type { SandboxBillingMode } from "@/lib/sandbox/billing";
import type { Repo, Workspace } from "@/lib/types";

export type RepoSandboxBillingModeControl = "inherit" | SandboxBillingMode;

export type VercelTeamOption = {
  id: string;
  name: string;
};

export type WorkspaceSandboxSettingsDraft = {
  billingMode: SandboxBillingMode;
  timeoutMs: number;
  idleTimeoutMs: number;
  vercelTeamId: string;
  vercelProjectId: string;
};

export type RepoSandboxSettingsDraft = {
  billingModeOverride: RepoSandboxBillingModeControl;
  vercelTeamId: string;
  vercelProjectId: string;
};

export function createWorkspaceSandboxSettingsDraft(
  workspace?: Workspace | null
): WorkspaceSandboxSettingsDraft {
  return {
    billingMode: workspace?.sandbox_billing_mode || "platform",
    timeoutMs: workspace?.sandbox_timeout_ms ?? DEFAULT_SANDBOX_TIMEOUT_MS,
    idleTimeoutMs:
      workspace?.sandbox_idle_timeout_ms ?? DEFAULT_SANDBOX_IDLE_TIMEOUT_MS,
    vercelTeamId: workspace?.sandbox_vercel_team_id || "",
    vercelProjectId: workspace?.sandbox_vercel_project_id || "",
  };
}

export function createRepoSandboxSettingsDraft(
  repo: Repo
): RepoSandboxSettingsDraft {
  return {
    billingModeOverride: repo.sandbox_billing_mode_override || "inherit",
    vercelTeamId: repo.vercel_team_id || "",
    vercelProjectId: repo.vercel_project_id || "",
  };
}

export function buildWorkspaceSandboxSettingsModel(
  draft: WorkspaceSandboxSettingsDraft
) {
  const linkedProject = resolveBillingLinkedProjectSelection({
    workspaceBillingModeInput: draft.billingMode,
    workspaceLinkedProjectId: draft.vercelProjectId,
    workspaceLinkedTeamId: draft.vercelTeamId,
  });

  return {
    teamScope: draft.vercelTeamId || "personal",
    needsLinkedProject:
      linkedProject.billingMode === "user_vercel_project" &&
      !linkedProject.projectId,
    effectiveLinkedProjectId: linkedProject.projectId || "",
    effectiveLinkedTeamId: linkedProject.teamId || "",
    effectiveLinkedProjectSource: linkedProject.source,
    effectiveOwnerLabel:
      draft.billingMode === "user_vercel_project"
        ? "Your Vercel project"
        : "Mogplex platform project",
  };
}

export function buildWorkspaceSandboxSettingsPayload(
  draft: WorkspaceSandboxSettingsDraft
) {
  return {
    sandbox_billing_mode: draft.billingMode,
    sandbox_timeout_ms: draft.timeoutMs,
    sandbox_idle_timeout_ms: draft.idleTimeoutMs,
    sandbox_vercel_team_id: draft.vercelTeamId || null,
    sandbox_vercel_project_id: draft.vercelProjectId || null,
  };
}

export function resolveRepoTeamSelectionDraft(
  selectionValue: string,
  current: RepoSandboxSettingsDraft
): RepoSandboxSettingsDraft {
  if (
    selectionValue === "personal" ||
    selectionValue === INHERITED_WORKSPACE_TEAM_OPTION
  ) {
    return {
      ...current,
      vercelTeamId: "",
      vercelProjectId: "",
    };
  }

  return {
    ...current,
    vercelTeamId: selectionValue,
    vercelProjectId: "",
  };
}

export function buildRepoSandboxSettingsModel(
  repo: Repo,
  draft: RepoSandboxSettingsDraft,
  teams: VercelTeamOption[] = []
) {
  const workspaceBillingMode =
    repo.workspace?.sandbox_billing_mode || "platform";
  const inheritedWorkspaceProjectId =
    repo.workspace?.sandbox_vercel_project_id || "";
  const inheritedWorkspaceTeamId = repo.workspace?.sandbox_vercel_team_id || "";
  const effectiveBillingMode =
    draft.billingModeOverride === "inherit"
      ? resolveEffectiveSandboxBillingMode({
          workspaceBillingModeInput: workspaceBillingMode,
        })
      : draft.billingModeOverride;
  const linkedProject = resolveBillingLinkedProjectSelection({
    workspaceBillingModeInput: workspaceBillingMode,
    repoBillingModeOverrideInput:
      draft.billingModeOverride === "inherit"
        ? null
        : draft.billingModeOverride,
    repoLinkedProjectId: draft.vercelProjectId,
    repoLinkedTeamId: draft.vercelTeamId,
    workspaceLinkedProjectId: inheritedWorkspaceProjectId,
    workspaceLinkedTeamId: inheritedWorkspaceTeamId,
  });
  const effectiveLinkedProjectId = linkedProject.projectId || "";
  const effectiveLinkedProjectSource = linkedProject.source;
  const effectiveLinkedTeamId =
    resolveRepoLinkedTeamPersistence({
      repoLinkedTeamId: draft.vercelTeamId,
      repoLinkedProjectId: draft.vercelProjectId,
      workspaceLinkedTeamId: inheritedWorkspaceTeamId,
      usingWorkspaceTeam:
        !draft.vercelTeamId && Boolean(inheritedWorkspaceProjectId),
    }) || "";
  const { selectedTeamValue, teamScope, usingWorkspaceTeam } =
    resolveRepoSandboxTeamSelection({
      effectiveBillingMode,
      repoLinkedTeamId: draft.vercelTeamId,
      workspaceLinkedTeamId: inheritedWorkspaceTeamId,
      workspaceLinkedProjectId: inheritedWorkspaceProjectId,
    });

  const inheritedTeamName =
    teams.find((team) => team.id === inheritedWorkspaceTeamId)?.name ||
    (inheritedWorkspaceTeamId ? inheritedWorkspaceTeamId : "Personal");

  return {
    workspaceBillingMode,
    effectiveBillingMode,
    inheritedWorkspaceProjectId,
    inheritedWorkspaceTeamId,
    effectiveLinkedProjectId,
    effectiveLinkedProjectSource,
    effectiveLinkedTeamId,
    selectedTeamValue,
    teamScope,
    usingWorkspaceTeam,
    inheritedTeamName,
    needsLinkedProject:
      effectiveBillingMode === "user_vercel_project" &&
      !effectiveLinkedProjectId,
    effectiveOwnerLabel:
      effectiveBillingMode === "user_vercel_project"
        ? "Your Vercel project"
        : "Mogplex platform project",
    pinsInheritedWorkspaceTeam:
      usingWorkspaceTeam && Boolean(draft.vercelProjectId),
  };
}

export function buildRepoSandboxSettingsPayload(
  repo: Repo,
  draft: RepoSandboxSettingsDraft
) {
  const inheritedWorkspaceTeamId = repo.workspace?.sandbox_vercel_team_id || "";
  const normalizedProjectId = draft.vercelProjectId.trim() || null;
  const model = buildRepoSandboxSettingsModel(repo, draft);
  const normalizedTeamId = resolveRepoLinkedTeamPersistence({
    repoLinkedTeamId: draft.vercelTeamId,
    repoLinkedProjectId: normalizedProjectId,
    workspaceLinkedTeamId: inheritedWorkspaceTeamId,
    usingWorkspaceTeam: model.usingWorkspaceTeam,
  });

  return {
    sandbox_billing_target: normalizedTeamId
      ? ("team" as const)
      : ("personal" as const),
    sandbox_billing_mode_override:
      draft.billingModeOverride === "inherit"
        ? null
        : draft.billingModeOverride,
    vercel_team_id: normalizedTeamId,
    vercel_project_id: normalizedProjectId,
  };
}
