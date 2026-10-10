import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  isAutomationOnly,
  readStoredApiKeyAccess,
  requireFullAccessKey,
  teamAutomationRequired,
  type ApiKeyAccess,
  type MogplexApiCredential,
} from "./credential-boundary";
import { mogplexApiError, type MogplexApiErrorBody } from "./response";

/** What a key is about to act on, as the route knows it. */
export type TeamKeyAccessTarget =
  | { repoId: string }
  | { installationId: number }
  | { automationId: string };

export type LoadTeamKeyAccess = (
  userId: string,
  target: TeamKeyAccessTarget
) => Promise<ApiKeyAccess | null>;

async function teamIdForRepo(
  client: SupabaseClient,
  userId: string,
  repoId: string
) {
  const { data, error } = await client
    .from("repos")
    .select("product_team_id")
    .eq("id", repoId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.product_team_id as string | null | undefined) ?? null;
}

async function teamIdForInstallation(
  client: SupabaseClient,
  userId: string,
  installationId: number
) {
  const { data, error } = await client
    .from("github_installations")
    .select("product_team_id")
    .eq("installation_id", installationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.product_team_id as string | null | undefined) ?? null;
}

async function teamIdForAutomation(
  client: SupabaseClient,
  userId: string,
  automationId: string
) {
  const { data, error } = await client
    .from("flows")
    .select("installation_id")
    .eq("id", automationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const installationId = data?.installation_id as number | null | undefined;
  return installationId
    ? teamIdForInstallation(client, userId, installationId)
    : null;
}

async function readTeamApiKeyAccess(client: SupabaseClient, teamId: string) {
  const { data, error } = await client
    .from("teams")
    .select("api_key_access")
    .eq("id", teamId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? readStoredApiKeyAccess(data.api_key_access, { teamId }) : null;
}

/** The key access a team owner set for one team; null when the team is gone. */
export function loadTeamApiKeyAccessById(
  teamId: string
): Promise<ApiKeyAccess | null> {
  return readTeamApiKeyAccess(supabaseAdmin, teamId);
}

/**
 * The key access of the team that owns the target, or null when the target
 * belongs to no team (or to no one: the route's own lookup reports that).
 */
export function createLoadTeamKeyAccess(
  client: SupabaseClient
): LoadTeamKeyAccess {
  return async (userId, target) => {
    const teamId =
      "repoId" in target
        ? await teamIdForRepo(client, userId, target.repoId)
        : "installationId" in target
          ? await teamIdForInstallation(client, userId, target.installationId)
          : await teamIdForAutomation(client, userId, target.automationId);
    return teamId ? readTeamApiKeyAccess(client, teamId) : null;
  };
}

export const loadTeamKeyAccess: LoadTeamKeyAccess = (userId, target) =>
  createLoadTeamKeyAccess(supabaseAdmin)(userId, target);

function teamLookupUnavailable(error: unknown) {
  // Fail closed: a key never acts on a target whose team policy is unknown.
  console.error("[mogplex-api] team key access lookup failed", { error });
  return mogplexApiError(
    "SERVICE_UNAVAILABLE",
    "Unable to check this team's API key access. Nothing was started; retry shortly.",
    503
  );
}

/**
 * Whether the credential is held to API-trigger automations on the target:
 * its own access, or the target team's. Interactive logins skip the lookup.
 */
export async function resolveAutomationOnly(
  user: MogplexApiCredential & { userId: string },
  target: TeamKeyAccessTarget,
  load: LoadTeamKeyAccess = loadTeamKeyAccess
): Promise<
  | { ok: true; automationOnly: boolean }
  | { ok: false; response: NextResponse<MogplexApiErrorBody> }
> {
  if (user.credentialKind !== "integration") {
    return { ok: true, automationOnly: false };
  }
  if (isAutomationOnly(user)) return { ok: true, automationOnly: true };
  try {
    return {
      ok: true,
      automationOnly: isAutomationOnly(user, await load(user.userId, target)),
    };
  } catch (error) {
    return { ok: false, response: teamLookupUnavailable(error) };
  }
}

/**
 * Null when the credential may act directly on every target, otherwise the
 * 403 to return. Interactive logins skip the lookup; an `automations` key is
 * refused without one; a `full` key is refused on a team that holds keys to
 * automations.
 */
export async function requireKeyAllowedOn(
  user: MogplexApiCredential & { userId: string },
  targets: TeamKeyAccessTarget | readonly TeamKeyAccessTarget[],
  load: LoadTeamKeyAccess = loadTeamKeyAccess
): Promise<NextResponse<MogplexApiErrorBody> | null> {
  const keyRefusal = requireFullAccessKey(user);
  if (keyRefusal) return keyRefusal;
  const list: readonly TeamKeyAccessTarget[] = Array.isArray(targets)
    ? targets
    : [targets as TeamKeyAccessTarget];
  for (const target of list) {
    const resolved = await resolveAutomationOnly(user, target, load);
    if (!resolved.ok) return resolved.response;
    if (resolved.automationOnly) return teamAutomationRequired();
  }
  return null;
}
