import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getPlaywrightUserIdFromHeaders } from "@/lib/internal-api-auth";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

type ResolvedAuth = {
  profileId: string;
  authUserId: string | null;
  source: "supabase" | "playwright" | "api-key";
};

async function getSupabaseLinkedUserId(): Promise<ResolvedAuth | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const authUserId = data.user?.id;

  if (error || !authUserId) return undefined;

  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .single();

  if (!profile?.id) return undefined;

  return {
    profileId: profile.id as string,
    authUserId,
    source: "supabase",
  };
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

  // 1. Check for PAT (Personal Access Token) - highest priority for CLI
  const authHeader = headerStore.get("authorization");
  if (authHeader?.startsWith("Bearer mog_")) {
    const { resolveApiKey } = await import("@/lib/auth/api-key");
    const apiKeyResult = await resolveApiKey(authHeader);
    if (apiKeyResult.ok) {
      return {
        profileId: apiKeyResult.auth.userId,
        authUserId: null,
        source: "api-key",
      };
    }
    // Rate-limited and invalid both fall through to other auth strategies
    // here; the public v1 API surface maps rate_limited → 429 separately
    // via resolveMogplexApiUser.
  }

  // 2. Playwright internal auth (for E2E tests)
  const playwrightUserId = getPlaywrightUserIdFromHeaders(headerStore);
  if (playwrightUserId) {
    return {
      profileId: playwrightUserId,
      authUserId: null,
      source: "playwright",
    };
  }

  // 3. Supabase session cookie auth
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
