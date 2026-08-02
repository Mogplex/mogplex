import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAppUrl, getCanonicalAppUrl } from "@/lib/app-url";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildAuthorizeUrl,
  generatePkceChallenge,
  prepareOAuthConnection,
} from "@/lib/connections/oauth";
import { requireUserId } from "@/lib/auth";
import { getConnectionPreset } from "@/lib/connections/presets";
import type { Connection } from "@/lib/types";

/** Initiate OAuth flow for a connection */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { searchParams } = new URL(req.url);
  const connectionId = searchParams.get("connectionId");
  if (!connectionId)
    return NextResponse.json(
      { error: "connectionId required" },
      { status: 400 }
    );

  // Verify ownership + OAuth config
  const { data } = await supabaseAdmin
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
    if (conn.auth_type !== "oauth") {
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
    const cookieStore = await cookies();
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
      }
    );
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    console.error("[connections-oauth] authorization start failed", error);
    return NextResponse.redirect(
      buildAppUrl("/settings?tab=connections&oauth=setup_error", req)
    );
  }
}
