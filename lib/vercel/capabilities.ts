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

  return `${platformPrefix} Sign in with Vercel is identity-only; user-owned compute requires a future API-capable integration.`;
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
  const canLinkUserBillingProject = false;
  const canUseUserBilling = false;

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
