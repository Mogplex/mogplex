import { NextResponse } from "next/server";
import { buildAppUrl } from "@/lib/app-url";
import { getUserId } from "@/lib/auth";

function generateRandomString(length: number) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function generateCodeChallenge(verifier: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function GET(request: Request) {
  const userId = await getUserId();

  if (!userId) {
    return NextResponse.redirect(buildAppUrl("/login", request));
  }

  const state = generateRandomString(32);
  const nonce = generateRandomString(32);
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const redirectUri = buildAppUrl(
    "/api/auth/vercel/callback",
    request
  ).toString();

  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile offline_access",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const vercelUrl = `https://vercel.com/oauth/authorize?${params}`;

  // Return HTML 200 with Set-Cookie headers, then redirect to Vercel OAuth.
  // Vercel strips Set-Cookie from 307 redirects in route handlers, so we
  // can't use NextResponse.redirect here. JS is the primary navigation
  // (meta refresh has historically been unreliable when the URL contains
  // unescaped `&` in the attribute value); meta refresh stays as a
  // no-script fallback, and an anchor href as a no-meta fallback.
  //
  // The URL is embedded only in HTML attributes (HTML-escaped) — never
  // interpolated into the <script> body — so the inline script contains
  // no dynamic data and can't be broken out of by a future URL value that
  // happens to contain `</script>`.
  //
  // The inline <script> relies on the app CSP permitting `'unsafe-inline'`
  // for script-src (see next.config.mjs). If CSP is ever tightened to
  // nonce/hash-based, attach the nonce here or drop the JS path entirely
  // and rely on the meta-refresh + anchor fallback.
  const secure = process.env.NODE_ENV === "production";
  const cookieOpts = `Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`;

  const escapedUrl = vercelUrl
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connecting Vercel...</title><meta http-equiv="refresh" content="0;url=${escapedUrl}"></head><body><a id="vercel-redirect" href="${escapedUrl}">Connecting Vercel...</a><script>window.location.replace(document.getElementById("vercel-redirect").href);</script></body></html>`;

  const response = new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  response.headers.append(
    "Set-Cookie",
    `vercel_oauth_state=${state}; ${cookieOpts}`
  );
  response.headers.append(
    "Set-Cookie",
    `vercel_oauth_nonce=${nonce}; ${cookieOpts}`
  );
  response.headers.append(
    "Set-Cookie",
    `vercel_code_verifier=${codeVerifier}; ${cookieOpts}`
  );

  return response;
}
