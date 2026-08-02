export type VercelPlatformState = "ready" | "not_configured";
export type VercelPersonalState = "not_linked" | "linked";
export type VercelLinkedProjectState =
  | "none"
  | "account"
  | "workspace"
  | "repo";

export type VercelCapability = {
  platformState: VercelPlatformState;
  personalState: VercelPersonalState;
  linkedProjectState: VercelLinkedProjectState;
  canUsePlatformOps: boolean;
  canLinkUserBillingProject: boolean;
  canUseUserBilling: boolean;
  statusLabel: string;
  statusDetail: string;
};

type DeriveVercelCapabilityInput = {
  platformState: VercelPlatformState;
  personalState: VercelPersonalState;
  linkedProjectState: VercelLinkedProjectState;
};

function buildStatusDetail(input: DeriveVercelCapabilityInput) {
  const platformPrefix =
    input.platformState === "ready"
      ? "Mogplex platform Vercel is ready."
      : "Mogplex platform Vercel is not configured.";

  if (input.personalState === "not_linked") {
    return `${platformPrefix} Link Personal Vercel only if you want to bill sandboxes to your own Vercel project.`;
  }

  if (input.linkedProjectState === "account") {
    return `${platformPrefix} Personal Vercel is linked and a default billing project is set. Workspaces and repos can override it.`;
  }

  if (input.linkedProjectState === "repo") {
    return `${platformPrefix} Personal Vercel is linked and at least one repo billing link is selected.`;
  }

  if (input.linkedProjectState === "workspace") {
    return `${platformPrefix} Personal Vercel is linked and at least one project billing link is selected.`;
  }

  return `${platformPrefix} Personal Vercel is linked, but no billing project is selected yet.`;
}

export function resolveLinkedProjectState(input: {
  repoLinkedProjectCount?: number;
  workspaceLinkedProjectCount?: number;
  accountDefaultProjectId?: string | null;
}): VercelLinkedProjectState {
  if ((input.repoLinkedProjectCount ?? 0) > 0) {
    return "repo";
  }

  if ((input.workspaceLinkedProjectCount ?? 0) > 0) {
    return "workspace";
  }

  if (input.accountDefaultProjectId) {
    return "account";
  }

  return "none";
}

export function deriveVercelCapability(
  input: DeriveVercelCapabilityInput
): VercelCapability {
  const canUsePlatformOps = input.platformState === "ready";
  const canLinkUserBillingProject = input.personalState === "linked";
  const canUseUserBilling =
    canLinkUserBillingProject &&
    (input.linkedProjectState === "repo" ||
      input.linkedProjectState === "workspace" ||
      input.linkedProjectState === "account");

  return {
    ...input,
    canUsePlatformOps,
    canLinkUserBillingProject,
    canUseUserBilling,
    statusLabel: canUsePlatformOps
      ? "Platform ready"
      : "Platform not configured",
    statusDetail: buildStatusDetail(input),
  };
}
