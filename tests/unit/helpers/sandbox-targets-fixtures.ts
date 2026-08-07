export async function loadSandboxCredentials() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../lib/sandbox/get-user-credentials");
}

export async function loadSandboxBilling() {
  return import("../../../lib/sandbox/billing");
}

type SandboxCredentials = {
  vercelToken: string | null;
  vercelTeamId: string | null;
  vercelProjectId: string | null;
  allowPlatformSandbox: boolean;
  userVercelToken: string | null;
  userVercelTeamId: string | null;
};

export function buildPlatformCredentials(
  overrides?: Partial<SandboxCredentials>
): SandboxCredentials {
  const result: SandboxCredentials = {
    vercelToken: "platform-token",
    vercelTeamId: "platform-team",
    vercelProjectId: "platform-project",
    allowPlatformSandbox: true,
    userVercelToken: null,
    userVercelTeamId: null,
  };
  if (overrides && "vercelToken" in overrides)
    result.vercelToken = overrides.vercelToken!;
  if (overrides && "vercelTeamId" in overrides)
    result.vercelTeamId = overrides.vercelTeamId!;
  if (overrides && "vercelProjectId" in overrides)
    result.vercelProjectId = overrides.vercelProjectId!;
  if (overrides && "allowPlatformSandbox" in overrides)
    result.allowPlatformSandbox = overrides.allowPlatformSandbox!;
  if (overrides && "userVercelToken" in overrides)
    result.userVercelToken = overrides.userVercelToken!;
  if (overrides && "userVercelTeamId" in overrides)
    result.userVercelTeamId = overrides.userVercelTeamId!;
  return result;
}

export function buildUserCredentials(
  overrides?: Partial<SandboxCredentials>
): SandboxCredentials {
  return {
    vercelToken: overrides?.vercelToken ?? "platform-token",
    vercelTeamId: overrides?.vercelTeamId ?? "platform-team",
    vercelProjectId: overrides?.vercelProjectId ?? "platform-project",
    allowPlatformSandbox: overrides?.allowPlatformSandbox ?? true,
    userVercelToken: overrides?.userVercelToken ?? "user-token",
    userVercelTeamId: overrides?.userVercelTeamId ?? "user-team",
  };
}

export function buildPlatformTarget() {
  return {
    ok: true as const,
    billingSource: "platform" as const,
    credentialSource: "platform" as const,
    projectId: null,
    teamId: null,
  };
}

export function buildUserTarget(projectId: string, teamId: string | null) {
  return {
    ok: true as const,
    billingSource: "user_vercel_project" as const,
    credentialSource: "user" as const,
    teamId,
    projectId,
  };
}

type SandboxRecord = {
  billing_source: "platform" | "user_vercel_project";
  billing_project_id: string | null;
  billing_team_id: string | null;
  vercel_project_id: string | null;
  vercel_team_id: string | null;
};

export function buildPlatformRecord(
  overrides?: Partial<Omit<SandboxRecord, "billing_source">>
): SandboxRecord {
  const result: SandboxRecord = {
    billing_source: "platform",
    billing_project_id: "platform-project",
    billing_team_id: null,
    vercel_project_id: "platform-project",
    vercel_team_id: null,
  };
  if (overrides && "billing_project_id" in overrides)
    result.billing_project_id = overrides.billing_project_id!;
  if (overrides && "billing_team_id" in overrides)
    result.billing_team_id = overrides.billing_team_id!;
  if (overrides && "vercel_project_id" in overrides)
    result.vercel_project_id = overrides.vercel_project_id!;
  if (overrides && "vercel_team_id" in overrides)
    result.vercel_team_id = overrides.vercel_team_id!;
  return result;
}

export function buildUserRecord(
  projectId: string | null,
  teamId: string | null
): SandboxRecord {
  return {
    billing_source: "user_vercel_project",
    billing_project_id: projectId,
    billing_team_id: teamId,
    vercel_project_id: projectId,
    vercel_team_id: teamId,
  };
}
