import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAppUrl } from "@/lib/app-url";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { storeOAuthToken } from "@/lib/oauth-tokens";
import { getUserId } from "@/lib/auth";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookieStore = await cookies();
  const storedState = cookieStore.get("vercel_oauth_state")?.value;
  const codeVerifier = cookieStore.get("vercel_code_verifier")?.value;
  const redirectUri = buildAppUrl(
    "/api/auth/vercel/callback",
    request
  ).toString();
  const userId = await getUserId();
  const redirect = (path: string) =>
    NextResponse.redirect(buildAppUrl(path, request));

  if (!code || !state || state !== storedState) {
    return redirect("/login?error=invalid_state");
  }

  if (!codeVerifier) {
    return redirect("/login?error=missing_verifier");
  }

  if (!userId) {
    return redirect("/login?error=vercel_requires_github_login");
  }

  const tokenRes = await fetch("https://api.vercel.com/login/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID!,
      client_secret: process.env.VERCEL_APP_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    console.error("[vercel-callback] token exchange failed:", tokenRes.status);
    return redirect("/login?error=token_exchange");
  }

  const tokenData = await tokenRes.json();
  const { access_token, team_id: oauthTeamId } = tokenData;

  const [userInfoRes, teamsRes] = await Promise.all([
    fetch("https://api.vercel.com/login/oauth/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    }),
    fetch("https://api.vercel.com/v2/teams?limit=1", {
      headers: { Authorization: `Bearer ${access_token}` },
    }),
  ]);

  if (!userInfoRes.ok) {
    console.error("[vercel-callback] user fetch failed:", userInfoRes.status);
    return redirect("/login?error=user_fetch");
  }

  const userInfo = (await userInfoRes.json()) as {
    sub: string;
    email?: string;
    name?: string;
    preferred_username?: string;
    picture?: string;
  };

  // Determine team ID
  let vercelTeamId = oauthTeamId || null;
  if (!vercelTeamId && teamsRes.ok) {
    const { teams } = await teamsRes.json();
    if (teams?.length > 0) vercelTeamId = teams[0].id;
  }
  if (!vercelTeamId) vercelTeamId = userInfo.sub;

  // Upsert profile
  const { data: existingUser } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .single();

  if (existingUser) {
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({
        email: userInfo.email,
        username: userInfo.preferred_username,
        name: userInfo.name,
        avatar_url: userInfo.picture,
        vercel_team_id: vercelTeamId,
        auth_provider: "vercel",
        last_auth_at: new Date().toISOString(),
      })
      .eq("id", existingUser.id);

    if (updateErr)
      console.error(
        "[vercel-callback] profile update error:",
        updateErr.message
      );
  } else {
    const { error: insertErr } = await supabaseAdmin.from("profiles").insert({
      id: userId,
      vercel_id: userInfo.sub,
      email: userInfo.email,
      username: userInfo.preferred_username,
      name: userInfo.name,
      avatar_url: userInfo.picture,
      vercel_team_id: vercelTeamId,
      auth_provider: "vercel",
      last_auth_at: new Date().toISOString(),
    });

    if (insertErr)
      console.error(
        "[vercel-callback] profile insert error:",
        insertErr.message
      );
  }

  try {
    await storeOAuthToken(userId, "vercel", access_token);
  } catch (tokenStoreError) {
    console.error("[vercel-callback] token store failed:", tokenStoreError);
    return redirect("/login?error=token_store");
  }

  cookieStore.delete("vercel_oauth_state");
  cookieStore.delete("vercel_oauth_nonce");
  cookieStore.delete("vercel_code_verifier");

  // TODO(#557 commit 3): resolve user scope from x-mogplex-scope-* headers (set by middleware)
  // and redirect to scopedHref(scope, "/settings?vercel=connected"). For now, send to root and
  // let middleware route to the user's personal slug once it lands.
  return redirect("/?vercel=connected");
}
