import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAppUrl, normalizeAppRedirectPath } from "@/lib/app-url";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  exchangeCodeForTokens,
  storeOAuthTokensWithRetry,
} from "@/lib/connections/oauth";
import { getUserId } from "@/lib/auth";
import type { StoredOAuthConnectionState } from "@/lib/connections/oauth";
import type { Connection } from "@/lib/types";

import {
  connectionOAuthCallbackQuerySchema,
  connectionOAuthStateSchema,
} from "./schema";

const defaultDeps = {
  getUserId,
  db: supabaseAdmin,
  getCookies: async (): Promise<{
    get: (name: string) => { value: string } | undefined;
  }> => cookies(),
};

export function createConnectionOAuthCallbackGetHandler(
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  /** Handle OAuth callback — exchange code for tokens */
  return async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const parsedQuery = connectionOAuthCallbackQuerySchema.safeParse({
      code: searchParams.get("code"),
      state: searchParams.get("state"),
    });
    const cookieStore = await deps.getCookies();
    const storedState = cookieStore.get("conn_oauth_state")?.value;
    const pkceVerifier = cookieStore.get("conn_oauth_pkce_verifier")?.value;
    const returnTo = normalizeAppRedirectPath(
      cookieStore.get("conn_oauth_return_to")?.value
    );
    const connectionsSuccessUrl = buildAppUrl(
      returnTo === "/" ? "/connections" : returnTo,
      req
    );
    connectionsSuccessUrl.searchParams.set("oauth", "success");
    const redirect = (path: string) =>
      NextResponse.redirect(buildAppUrl(path, req));
    const clearCookies = (response: NextResponse) => {
      response.headers.append(
        "Set-Cookie",
        "conn_oauth_return_to=; Path=/; Max-Age=0"
      );
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

    // The proxy resolves this unscoped route to the authenticated personal scope.
    if (!parsedQuery.success || parsedQuery.data.state !== storedState) {
      return clearCookies(redirect("/connections?oauth=invalid_state"));
    }

    const { code, state } = parsedQuery.data;
    const userId = await deps.getUserId();
    if (!userId) {
      return clearCookies(redirect("/login?error=unauthorized"));
    }

    // Parse state to get connectionId and verify userId matches
    let connectionId: string;
    try {
      const parsed = connectionOAuthStateSchema.safeParse(
        JSON.parse(atob(state))
      );
      if (!parsed.success || parsed.data.userId !== userId) {
        return clearCookies(redirect("/connections?oauth=invalid_state"));
      }
      connectionId = parsed.data.connectionId;
    } catch {
      return clearCookies(redirect("/connections?oauth=invalid_state"));
    }

    // Fetch connection
    const { data } = await deps.db
      .from("connections")
      .select("*, encrypted_credentials")
      .eq("id", connectionId)
      .eq("user_id", userId)
      .single();

    if (!data) {
      return clearCookies(redirect("/connections?oauth=not_found"));
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

      return clearCookies(NextResponse.redirect(connectionsSuccessUrl));
    } catch (err) {
      console.error(
        "[oauth-callback] token exchange failed:",
        err instanceof Error ? err.message : err
      );
      return clearCookies(redirect("/connections?oauth=token_error"));
    }
  };
}

export const GET = createConnectionOAuthCallbackGetHandler();
