import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAppUrl } from "@/lib/app-url";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  exchangeCodeForTokens,
  storeOAuthTokensWithRetry,
} from "@/lib/connections/oauth";
import { getUserId } from "@/lib/auth";
import type { StoredOAuthConnectionState } from "@/lib/connections/oauth";
import type { Connection } from "@/lib/types";

/** Handle OAuth callback — exchange code for tokens */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookieStore = await cookies();
  const storedState = cookieStore.get("conn_oauth_state")?.value;
  const pkceVerifier = cookieStore.get("conn_oauth_pkce_verifier")?.value;
  const settingsSuccessUrl = buildAppUrl(
    "/settings?tab=connections&oauth=success",
    req
  );
  const redirect = (path: string) =>
    NextResponse.redirect(buildAppUrl(path, req));
  const clearCookies = (response: NextResponse) => {
    response.headers.append(
      "Set-Cookie",
      "conn_oauth_state=; Path=/; Max-Age=0"
    );
    response.headers.append(
      "Set-Cookie",
      "conn_oauth_pkce_verifier=; Path=/; Max-Age=0"
    );
    return response;
  };

  // TODO(#557 commit 3): resolve user scope from x-mogplex-scope-* headers and wrap these
  // redirects via scopedHref. Root path bounces through middleware to the personal slug for now.
  if (!code || !state || state !== storedState) {
    return clearCookies(redirect("/?tab=connections&oauth=invalid_state"));
  }

  const userId = await getUserId();
  if (!userId) {
    return clearCookies(redirect("/login?error=unauthorized"));
  }

  // Parse state to get connectionId and verify userId matches
  let connectionId: string;
  try {
    const parsed = JSON.parse(atob(state)) as {
      connectionId: string;
      nonce: string;
      userId: string;
    };
    connectionId = parsed.connectionId;
    if (parsed.userId !== userId) {
      return clearCookies(redirect("/?tab=connections&oauth=invalid_state"));
    }
  } catch {
    return clearCookies(redirect("/?tab=connections&oauth=invalid_state"));
  }

  // Fetch connection
  const { data } = await supabaseAdmin
    .from("connections")
    .select("*, encrypted_credentials")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .single();

  if (!data) {
    return clearCookies(redirect("/?tab=connections&oauth=not_found"));
  }

  const conn = data as Connection;
  const redirectUri = buildAppUrl(
    "/api/connections/oauth/callback",
    req
  ).toString();

  try {
    const tokens = await exchangeCodeForTokens(conn, code, redirectUri, {
      codeVerifier: pkceVerifier,
    });
    const stored = await storeOAuthTokensWithRetry(
      connectionId,
      {
        encrypted_credentials: data.encrypted_credentials,
        updated_at: data.updated_at,
        oauth_authorized_at: data.oauth_authorized_at,
        oauth_token_expires_at: data.oauth_token_expires_at,
      } satisfies StoredOAuthConnectionState,
      tokens
    );

    if (!stored) {
      throw new Error("Failed to persist OAuth tokens");
    }

    return clearCookies(NextResponse.redirect(settingsSuccessUrl));
  } catch (err) {
    console.error(
      "[oauth-callback] token exchange failed:",
      err instanceof Error ? err.message : err
    );
    return clearCookies(redirect("/?tab=connections&oauth=token_error"));
  }
}
