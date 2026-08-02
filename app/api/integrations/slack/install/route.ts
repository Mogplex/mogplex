import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUserId } from "@/lib/auth";
import { buildAppUrl } from "@/lib/app-url";
import {
  buildSlackAuthorizeUrl,
  getSlackOAuthConfig,
  signSlackOAuthState,
  SLACK_OAUTH_STATE_COOKIE,
  SLACK_OAUTH_STATE_TTL_SECONDS,
} from "@/lib/slack/oauth";

/**
 * Kicks off the Slack OAuth install dance. The current Mogplex user is bound
 * into a signed state token; the callback verifies both the HMAC and the
 * cookie nonce before persisting the workspace install.
 */
export async function GET(request: Request) {
  const userIdOrResponse = await requireUserId();
  if (userIdOrResponse instanceof Response) {
    return userIdOrResponse;
  }
  const userId = userIdOrResponse;

  const config = getSlackOAuthConfig(request);
  if (!config) {
    return NextResponse.redirect(
      buildAppUrl("/settings?slack=not_configured", request)
    );
  }

  const nonce = crypto.randomBytes(24).toString("base64url");
  const ts = Math.floor(Date.now() / 1000);
  const state = signSlackOAuthState(
    { userId, nonce, ts },
    config.signingSecret
  );

  const cookieStore = await cookies();
  cookieStore.set(SLACK_OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SLACK_OAUTH_STATE_TTL_SECONDS,
  });

  return NextResponse.redirect(
    buildSlackAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
    })
  );
}
