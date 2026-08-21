import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getPlaywrightUserIdFromHeaders } from "@/lib/internal-api-auth";
import { resolveCliBearerAuth } from "@/lib/auth/cli-bearer";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

type ResolvedAuth = {
  profileId: string;
  authUserId: string | null;
  source: "supabase" | "better-auth" | "playwright" | "api-key" | "oauth";
};

async function findProfileIdByAuthUserId(
  authUserId: string
): Promise<string | undefined> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .single();
  return (profile?.id as string | undefined) ?? undefined;
}

async function getSupabaseLinkedUserId(): Promise<ResolvedAuth | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const authUserId = data.user?.id;

  if (error || !authUserId) return undefined;

  const profileId = await findProfileIdByAuthUserId(authUserId);
  if (!profileId) return undefined;

  return { profileId, authUserId, source: "supabase" };
}

async function getBetterAuthLinkedUserId(): Promise<ResolvedAuth | undefined> {
  const { auth } = await import("@/lib/better-auth/server");
  const session = await auth.api.getSession({ headers: await headers() });
  const authUserId = session?.user?.id;
  if (!authUserId) return undefined;

  const profileId = await findProfileIdByAuthUserId(authUserId);
  if (!profileId) return undefined;

  return { profileId, authUserId, source: "better-auth" };
}

export async function getProfileId(): Promise<string | undefined> {
  return (await getResolvedAuth())?.profileId;
}

/**
 * Returns the Mogplex profile id, not `auth.users.id`.
 * Kept for compatibility with existing call sites.
 */
export async function getUserId(): Promise<string | undefined> {
  return getProfileId();
}

export async function getResolvedAuth(): Promise<ResolvedAuth | undefined> {
  const headerStore = await headers();

  // 1. Check CLI bearer credentials before browser sessions.
  const authHeader = headerStore.get("authorization");
  const cliBearerAuth = await resolveCliBearerAuth(authHeader);
  if (cliBearerAuth) {
    return {
      profileId: cliBearerAuth.profileId,
      authUserId: null,
      source: cliBearerAuth.source,
    };
  }
  // Rate-limited and invalid credentials fall through to browser auth. The
  // public v1 API maps rate-limited PATs to 429 via resolveMogplexApiUser.

  // 2. Playwright internal auth (for E2E tests)
  const playwrightUserId = getPlaywrightUserIdFromHeaders(headerStore);
  if (playwrightUserId) {
    return {
      profileId: playwrightUserId,
      authUserId: null,
      source: "playwright",
    };
  }

  // 3. Session cookie auth — better-auth once the data backend is Neon
  // (profiles and better-auth users share that database), Supabase before.
  if (process.env.MOGPLEX_DATA_BACKEND === "neon") {
    return getBetterAuthLinkedUserId();
  }
  return getSupabaseLinkedUserId();
}

export function ensureUserId(userId: string | undefined) {
  return (
    userId ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  );
}

export async function requireProfileId() {
  return ensureUserId(await getProfileId());
}

/**
 * Returns the Mogplex profile id, not `auth.users.id`.
 * Kept for compatibility with existing call sites.
 */
export async function requireUserId() {
  return requireProfileId();
}
