import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDelegatedUserIdFromRequest } from "@/lib/internal-api-auth";
import { getOAuthToken } from "@/lib/oauth-tokens";
import {
  loadUserPlatformAccess,
  PLATFORM_SANDBOX_ACCESS_ERROR,
  PLATFORM_SANDBOX_RECORD_ACCESS_ERROR,
} from "@/lib/platform-access";
import { getUserId } from "@/lib/auth";
import { resolveSandboxBilling } from "@/lib/sandbox/billing";
import { deferTeamAuditEvent, recordTeamAuditEvent } from "@/lib/team-audit";
import {
  ALL_CAPABILITIES,
  hasCapability,
  resolveMemberCapabilities,
  type Capability,
} from "@/lib/team-capabilities";
import type { SandboxBillingMode } from "@/lib/sandbox/billing";

/**
 * Thrown by `getSandboxServiceCredentials` when the caller passes
 * `requireCapability` and the active scope's role doesn't grant it.
 * Routes that don't explicitly catch this surface a 403 via the global
 * error handler; sandbox CREATE / EXEC routes pass `requireCapability:
 * "tools.bash"` so VM provisioning is blocked before any external call.
 */
export class SandboxCapabilityDeniedError extends Error {
  readonly status = 403;
  readonly capability: Capability;
  constructor(capability: Capability) {
    super(
      `Your team role does not allow this sandbox operation (${capability}).`
    );
    this.name = "SandboxCapabilityDeniedError";
    this.capability = capability;
  }
}

/**
 * Name-based typeguard. tsx + node:test can load the same module under two
 * URLs (path-alias vs relative-path resolution) so `instanceof` fails
 * across the boundary even though both classes have identical shape. The
 * name string is the stable contract.
 */
export function isSandboxCapabilityDeniedError(
  err: unknown
): err is SandboxCapabilityDeniedError {
  return (
    err instanceof Error &&
    err.name === "SandboxCapabilityDeniedError" &&
    typeof (err as { capability?: unknown }).capability === "string" &&
    (err as { status?: unknown }).status === 403
  );
}

/**
 * Platform sandbox operations require a platform Vercel project. The ID must
 * come from the environment — there is deliberately no hardcoded fallback so
 * the production project is never baked into the (public) source tree. Read
 * lazily so test suites can set the env var after module load.
 *
 * Deployments without platform sandbox config (self-hosted BYO Vercel) leave
 * the var unset: the ID stays null and only the platform-billing branches of
 * resolveSandboxTargetCredentials / resolveSandboxRecordCredentials reject —
 * personal-billing and env-var flows must keep working without it.
 */
function readDefaultVercelProjectId(): string | null {
  return process.env.VERCEL_PROJECT_ID?.trim() || null;
}

export const PLATFORM_VERCEL_PROJECT_NOT_CONFIGURED_ERROR =
  "Sandbox service not configured — set VERCEL_PROJECT_ID (see .env.example)";

/** Platform-level Vercel credentials for Mogplex-managed sandboxes. */
const PLATFORM_VERCEL_TOKEN = process.env.PLATFORM_VERCEL_TOKEN?.trim() || null;
const PLATFORM_VERCEL_TEAM_ID =
  process.env.PLATFORM_VERCEL_TEAM_ID?.trim() || null;

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type SandboxCredentialSource = "platform" | "user";

export type SandboxServiceCredentials = {
  userId: string;
  vercelToken: string | null;
  vercelTeamId: string | null;
  vercelProjectId: string | null;
  allowPlatformSandbox?: boolean;
  userVercelToken: string | null;
  userVercelTeamId: string | null;
  accountDefaultVercelProjectId: string | null;
  accountDefaultVercelTeamId: string | null;
};

export type SandboxTargetResolution =
  | {
      ok: true;
      billingSource: SandboxBillingMode;
      credentialSource: SandboxCredentialSource;
      teamId: string | null;
      projectId: string | null;
    }
  | {
      ok: false;
      billingSource: SandboxBillingMode;
      error: string;
    };

export function getPlatformSandboxCredentials() {
  return {
    vercelToken: PLATFORM_VERCEL_TOKEN,
    vercelTeamId: PLATFORM_VERCEL_TEAM_ID,
    vercelProjectId: readDefaultVercelProjectId(),
  };
}

/**
 * Get the current user's connected credentials.
 * This is used for user-managed integrations like linking a Vercel project.
 */
export async function getUserCredentials() {
  const userId = await getUserId();

  if (!userId) return null;

  const profile = await loadUserVercelProfile(userId);

  if (!profile) return null;

  const [githubToken, vercelToken] = await Promise.all([
    getOAuthToken(profile.id, "github"),
    getOAuthToken(profile.id, "vercel"),
  ]);

  return {
    userId: profile.id,
    githubToken,
    vercelToken,
    vercelTeamId: profile.vercel_team_id as string | null,
  };
}

/**
 * Get the platform-managed Vercel credentials used for ephemeral Mogplex sandboxes.
 *
 * When called with `requireCapability`, the function fails closed before
 * returning credentials: it resolves the active scope's capability set
 * (solo → ALL_CAPABILITIES; team → role preset via team_members) and
 * throws `SandboxCapabilityDeniedError` if the required capability isn't
 * granted. This blocks VM provisioning at the credentials boundary so
 * viewer-role members can't reach the launch path even via a forged body.
 */
export async function getSandboxServiceCredentials(
  request?: Request,
  options?: {
    allowInternal?: boolean;
    teamId?: string | null;
    auditTargetId?: string | null;
    capabilities?: ReadonlySet<Capability>;
    requireCapability?: Capability;
  }
): Promise<SandboxServiceCredentials | null> {
  const userId =
    options?.allowInternal && request
      ? (getDelegatedUserIdFromRequest(request) ?? (await getUserId()))
      : await getUserId();

  if (!userId) return null;

  if (options?.requireCapability) {
    const caps: ReadonlySet<Capability> = options.capabilities
      ? options.capabilities
      : options.teamId
        ? await resolveMemberCapabilities(userId, options.teamId)
        : ALL_CAPABILITIES;
    if (!hasCapability(caps, options.requireCapability)) {
      if (options.teamId) {
        deferTeamAuditEvent(recordTeamAuditEvent, {
          productTeamId: options.teamId,
          actorUserId: userId,
          action: "sandbox.denied",
          decisionCode: "capability_denied",
          targetType: "sandbox",
          targetId: options.auditTargetId ?? null,
          payload: { required_capability: options.requireCapability },
        });
      }
      throw new SandboxCapabilityDeniedError(options.requireCapability);
    }
  }

  return loadSandboxServiceCredentialsForUser(userId);
}

/**
 * Resolve sandbox credentials for an already-authenticated user boundary.
 * Public API adapters use this after PAT ownership has been established so
 * they can reuse the normal sandbox launch service without manufacturing a
 * browser session or exposing internal machine credentials.
 */
export async function loadSandboxServiceCredentialsForUser(
  userId: string
): Promise<SandboxServiceCredentials> {
  const [profile, userVercelToken, platformAccess] = await Promise.all([
    loadUserVercelProfile(userId),
    getOAuthToken(userId, "vercel").catch(() => null),
    loadUserPlatformAccess(userId).catch(() => ({
      allowPlatformAi: false,
      allowPlatformSandbox: false,
    })),
  ]);

  return {
    userId,
    ...getPlatformSandboxCredentials(),
    allowPlatformSandbox: platformAccess.allowPlatformSandbox,
    userVercelToken,
    userVercelTeamId: (profile?.vercel_team_id as string | null) ?? null,
    accountDefaultVercelProjectId:
      (profile?.default_vercel_project_id as string | null) ?? null,
    accountDefaultVercelTeamId:
      (profile?.default_vercel_team_id as string | null) ?? null,
  };
}

async function loadUserVercelProfile(userId: string) {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, vercel_team_id, default_vercel_project_id, default_vercel_team_id"
    )
    .eq("id", userId)
    .single();

  return profile;
}

export async function loadUserVercelCredentials(userId: string) {
  const [profile, userVercelToken] = await Promise.all([
    loadUserVercelProfile(userId),
    getOAuthToken(userId, "vercel").catch(() => null),
  ]);

  return {
    userVercelToken,
    userVercelTeamId: (profile?.vercel_team_id as string | null) ?? null,
    accountDefaultVercelProjectId:
      (profile?.default_vercel_project_id as string | null) ?? null,
    accountDefaultVercelTeamId:
      (profile?.default_vercel_team_id as string | null) ?? null,
  };
}

export function resolveSandboxTarget(input?: {
  workspaceBillingModeInput?: unknown;
  repoBillingModeOverrideInput?: unknown;
  repoLinkedProjectId?: unknown;
  repoLinkedTeamId?: unknown;
  workspaceLinkedProjectId?: unknown;
  workspaceLinkedTeamId?: unknown;
  accountLinkedProjectId?: unknown;
  accountLinkedTeamId?: unknown;
}): SandboxTargetResolution {
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

  if (!resolution.ok) {
    return {
      ok: false,
      billingSource: resolution.billingSource,
      error: resolution.error,
    };
  }

  if (resolution.billingSource === "user_vercel_project") {
    return {
      ok: true,
      billingSource: resolution.billingSource,
      credentialSource: "user",
      teamId: resolution.teamId,
      projectId: resolution.projectId,
    };
  }

  return {
    ok: true,
    billingSource: "platform",
    credentialSource: "platform",
    teamId: null,
    projectId: null,
  };
}

export function resolveSandboxTargetCredentials(
  creds: Pick<
    SandboxServiceCredentials,
    | "vercelToken"
    | "vercelTeamId"
    | "vercelProjectId"
    | "allowPlatformSandbox"
    | "userVercelToken"
    | "userVercelTeamId"
  >,
  target: Extract<SandboxTargetResolution, { ok: true }>
) {
  if (
    target.credentialSource === "platform" &&
    creds.allowPlatformSandbox === false
  ) {
    return {
      ok: false as const,
      error: PLATFORM_SANDBOX_ACCESS_ERROR,
      status: 403 as const,
    };
  }

  if (target.credentialSource === "platform") {
    if (!creds.vercelToken) {
      return {
        ok: false as const,
        error: "Sandbox service not configured — set PLATFORM_VERCEL_TOKEN",
        status: 500 as const,
      };
    }

    if (!creds.vercelProjectId) {
      return {
        ok: false as const,
        error: PLATFORM_VERCEL_PROJECT_NOT_CONFIGURED_ERROR,
        status: 500 as const,
      };
    }

    return {
      ok: true as const,
      vercelToken: creds.vercelToken,
      vercelTeamId: creds.vercelTeamId,
      vercelProjectId: creds.vercelProjectId,
    };
  }

  if (!creds.userVercelToken) {
    return {
      ok: false as const,
      error: "Reconnect Vercel to launch sandboxes in a linked Vercel project.",
      status: 400 as const,
    };
  }

  if (!target.projectId) {
    return {
      ok: false as const,
      error:
        "Select or create a Vercel project for user-owned sandbox billing.",
      status: 400 as const,
    };
  }

  return {
    ok: true as const,
    vercelToken: creds.userVercelToken,
    vercelTeamId: target.teamId ?? null,
    vercelProjectId: target.projectId,
  };
}

export function resolveSandboxRecordCredentials(
  creds: Pick<
    SandboxServiceCredentials,
    | "vercelToken"
    | "vercelTeamId"
    | "vercelProjectId"
    | "allowPlatformSandbox"
    | "userVercelToken"
    | "userVercelTeamId"
  >,
  input: {
    billing_source?: string | null;
    billing_project_id?: string | null;
    billing_team_id?: string | null;
    vercel_project_id?: string | null;
    vercel_team_id?: string | null;
  }
) {
  const billingSource =
    input.billing_source === "user_vercel_project"
      ? "user_vercel_project"
      : input.billing_source === "platform"
        ? "platform"
        : null;
  const storedProjectId =
    normalizeOptionalText(input.billing_project_id) ||
    normalizeOptionalText(input.vercel_project_id);
  const recordProjectId =
    storedProjectId ||
    (billingSource === "user_vercel_project" ? null : creds.vercelProjectId);
  const recordTeamId =
    normalizeOptionalText(input.billing_team_id) ||
    normalizeOptionalText(input.vercel_team_id);
  const usesPlatformTarget = billingSource
    ? billingSource === "platform"
    : !storedProjectId ||
      (recordProjectId === creds.vercelProjectId &&
        recordTeamId === creds.vercelTeamId);

  if (usesPlatformTarget) {
    if (creds.allowPlatformSandbox === false) {
      return {
        ok: false as const,
        error: PLATFORM_SANDBOX_RECORD_ACCESS_ERROR,
        status: 403 as const,
      };
    }

    if (!creds.vercelToken) {
      return {
        ok: false as const,
        error: "Sandbox service not configured — set PLATFORM_VERCEL_TOKEN",
        status: 500 as const,
      };
    }

    const platformProjectId = recordProjectId || creds.vercelProjectId;

    if (!platformProjectId) {
      return {
        ok: false as const,
        error: PLATFORM_VERCEL_PROJECT_NOT_CONFIGURED_ERROR,
        status: 500 as const,
      };
    }

    return {
      ok: true as const,
      vercelToken: creds.vercelToken,
      vercelTeamId: recordTeamId,
      vercelProjectId: platformProjectId,
    };
  }

  if (!recordProjectId) {
    return {
      ok: false as const,
      error:
        "Sandbox is missing its stored Vercel project for user-owned billing.",
      status: 400 as const,
    };
  }

  if (!creds.userVercelToken) {
    return {
      ok: false as const,
      error:
        "Reconnect Vercel to manage sandboxes linked to your Vercel project.",
      status: 400 as const,
    };
  }

  return {
    ok: true as const,
    vercelToken: creds.userVercelToken,
    vercelTeamId: recordTeamId ?? null,
    vercelProjectId: recordProjectId,
  };
}
