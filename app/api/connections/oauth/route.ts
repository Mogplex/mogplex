import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAppUrl, getCanonicalAppUrl } from "@/lib/app-url";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildAuthorizeUrl,
  canPrepareOAuthConnection,
  generatePkceChallenge,
  getOAuthResourceIndicator,
  prepareOAuthConnection,
} from "@/lib/connections/oauth";
import { requireUserId } from "@/lib/auth";
import { getConnectionPreset } from "@/lib/connections/presets";
import type { Connection } from "@/lib/types";

import { connectionOAuthQuerySchema } from "./schema";

type OAuthCookieStore = {
  set: (
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      sameSite: "lax";
      maxAge: number;
      path: string;
      secure: boolean;
    }
  ) => unknown;
  delete: (name: string) => unknown;
};
const defaultDeps = {
  requireUserId,
  db: supabaseAdmin,
  getCookies: async (): Promise<OAuthCookieStore> => cookies(),
};

export function createConnectionOAuthGetHandler(
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  /** Initiate OAuth flow for a connection */
  return async function GET(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { searchParams } = new URL(req.url);
    const parsed = connectionOAuthQuerySchema.safeParse({
      connectionId: searchParams.get("connectionId"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid connection ID.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { connectionId } = parsed.data;

    // Verify ownership + OAuth config
    const { data } = await deps.db
      .from("connections")
      .select("*")
      .eq("id", connectionId)
      .eq("user_id", userId)
      .single();

    if (!data)
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );

    try {
      const conn = data as Connection;
      if (!canPrepareOAuthConnection(conn)) {
        return NextResponse.json(
          { error: "Connection is not configured for OAuth" },
          { status: 400 }
        );
      }

      const redirectUri = buildAppUrl(
        "/api/connections/oauth/callback",
        req
      ).toString();
      const prepared = await prepareOAuthConnection(conn, {
        redirectUri,
        origin: getCanonicalAppUrl(req).origin,
      });
      const resolvedConnection = prepared.connection;
      const preset = getConnectionPreset(resolvedConnection.source_preset);

      if (
        !resolvedConnection.oauth_authorize_url ||
        !resolvedConnection.oauth_client_id
      ) {
        return NextResponse.json(
          { error: "Connection is not configured for OAuth" },
          { status: 400 }
        );
      }

      const nonce = crypto.randomUUID();
      const state = btoa(JSON.stringify({ connectionId, nonce, userId }));

      // Store state in cookie for CSRF protection
      const cookieStore = await deps.getCookies();
      cookieStore.set("conn_oauth_state", state, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 600,
        path: "/",
        secure: process.env.NODE_ENV === "production",
      });
      if (prepared.codeVerifier) {
        cookieStore.set("conn_oauth_pkce_verifier", prepared.codeVerifier, {
          httpOnly: true,
          sameSite: "lax",
          maxAge: 600,
          path: "/",
          secure: process.env.NODE_ENV === "production",
        });
      } else {
        cookieStore.delete("conn_oauth_pkce_verifier");
      }

      const authorizeUrl = buildAuthorizeUrl(
        resolvedConnection,
        redirectUri,
        state,
        {
          codeChallenge: prepared.codeVerifier
            ? generatePkceChallenge(prepared.codeVerifier)
            : undefined,
          authorizeParams: preset?.oauth_config?.authorize_params,
          resource: getOAuthResourceIndicator(resolvedConnection),
        }
      );
      return NextResponse.redirect(authorizeUrl);
    } catch (error) {
      console.error("[connections-oauth] authorization start failed", error);
      return NextResponse.redirect(
        buildAppUrl("/connections?oauth=setup_error", req)
      );
    }
  };
}

export const GET = createConnectionOAuthGetHandler();
