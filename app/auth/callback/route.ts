import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAppUrl, normalizeAppRedirectPath } from "@/lib/app-url";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncGithubReposForUser } from "@/lib/github-sync";
import { defaultLoginNext, LOGIN_NEXT_FALLBACK } from "@/lib/login-next";
import { storeOAuthToken } from "@/lib/oauth-tokens";
import { insertProfileWithUniqueSlug } from "@/lib/profile-slug";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = normalizeAppRedirectPath(searchParams.get("next"));
  const redirect = (path: string) =>
    NextResponse.redirect(buildAppUrl(path, request));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.session) {
      const token = data.session.provider_token || null;
      const { user } = data.session;
      const cookieStore = await cookies();
      const legacyUserId = cookieStore.get("user_id")?.value;

      let githubProfile: {
        id?: number | null;
        login?: string;
        avatar_url?: string | null;
        name?: string | null;
        email?: string | null;
      } = {
        id: null,
        login:
          user.user_metadata?.user_name ||
          user.user_metadata?.preferred_username,
        avatar_url:
          user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
        name: user.user_metadata?.full_name || user.user_metadata?.name || null,
        email: user.email || null,
      };

      if (token) {
        const ghRes = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
          cache: "no-store",
        });

        if (ghRes.ok) {
          const ghUser = (await ghRes.json()) as {
            id?: unknown;
            login?: string;
            avatar_url?: string | null;
            name?: string | null;
            email?: string | null;
          };
          githubProfile = {
            id:
              typeof ghUser.id === "number"
                ? ghUser.id
                : (githubProfile.id ?? null),
            login: ghUser.login || githubProfile.login,
            avatar_url: ghUser.avatar_url ?? githubProfile.avatar_url ?? null,
            name: ghUser.name ?? githubProfile.name ?? null,
            email: ghUser.email ?? githubProfile.email ?? null,
          };
        }
      }

      const githubUsername = githubProfile.login || null;

      const { data: linkedProfile } = await supabaseAdmin
        .from("profiles")
        .select("id, auth_user_id")
        .eq("auth_user_id", user.id)
        .single();

      let targetProfileId = linkedProfile?.id || null;
      let insertedSlug: string | null = null;

      if (!targetProfileId && legacyUserId) {
        const { data: legacyProfile } = await supabaseAdmin
          .from("profiles")
          .select("id, auth_user_id")
          .eq("id", legacyUserId)
          .single();

        if (
          legacyProfile &&
          (!legacyProfile.auth_user_id ||
            legacyProfile.auth_user_id === user.id)
        ) {
          targetProfileId = legacyProfile.id;
        }
      }

      if (!targetProfileId && githubUsername) {
        const { data: githubProfileMatch } = await supabaseAdmin
          .from("profiles")
          .select("id, auth_user_id")
          .eq("github_username", githubUsername)
          .limit(1)
          .maybeSingle();

        if (
          githubProfileMatch &&
          (!githubProfileMatch.auth_user_id ||
            githubProfileMatch.auth_user_id === user.id)
        ) {
          targetProfileId = githubProfileMatch.id;
        }
      }

      if (targetProfileId) {
        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({
            auth_user_id: user.id,
            auth_provider: "github",
            last_auth_at: new Date().toISOString(),
            github_username: githubUsername,
            ...(typeof githubProfile.id === "number"
              ? { github_user_id: githubProfile.id }
              : {}),
            username: githubProfile.login || null,
            name: githubProfile.name || null,
            avatar_url: githubProfile.avatar_url || null,
            email: githubProfile.email || user.email || null,
            github_auth_mode: "oauth",
          })
          .eq("id", targetProfileId);

        if (updateError) {
          return redirect("/login/beta?error=github_profile_link");
        }
      } else {
        targetProfileId = crypto.randomUUID();
        let insertResult: Awaited<
          ReturnType<typeof insertProfileWithUniqueSlug>
        >;
        try {
          insertResult = await insertProfileWithUniqueSlug(
            supabaseAdmin,
            {
              id: targetProfileId,
              auth_user_id: user.id,
              auth_provider: "github",
              last_auth_at: new Date().toISOString(),
              github_username: githubUsername,
              github_user_id:
                typeof githubProfile.id === "number" ? githubProfile.id : null,
              username: githubProfile.login || null,
              name: githubProfile.name || null,
              avatar_url: githubProfile.avatar_url || null,
              email: githubProfile.email || user.email || null,
              github_auth_mode: "oauth",
            },
            {
              githubUsername,
              email: githubProfile.email || user.email || null,
            }
          );
        } catch (slugError) {
          console.error("[auth-callback] slug allocation threw", {
            slugError,
          });
          return redirect("/login/beta?error=github_profile_create");
        }

        if (!insertResult.ok) {
          console.error("[auth-callback] profile insert failed", {
            error: insertResult.error,
          });
          return redirect("/login/beta?error=github_profile_create");
        }
        insertedSlug = insertResult.slug;
      }

      if (targetProfileId && token) {
        try {
          await storeOAuthToken(targetProfileId, "github", token);
        } catch (tokenStoreError) {
          console.error("[auth-callback] failed to store GitHub OAuth token", {
            targetProfileId,
            tokenStoreError,
          });
          return redirect("/login/beta?error=github_token_store");
        }
      }

      if (targetProfileId && token) {
        try {
          await syncGithubReposForUser(targetProfileId, token);
        } catch (syncError) {
          console.error("[auth-callback] GitHub repo sync failed", {
            targetProfileId,
            syncError,
          });
        }
      }

      cookieStore.delete("user_id");

      // When no specific destination was supplied (sentinel "/"), substitute
      // the user's scoped workspace once we can read their personal slug.
      // Falling back to the sentinel sends them through proxy.ts which will
      // redirect "/" → "/${slug}" so the bare-slug page can take over.
      let finalNext = next;
      if (finalNext === LOGIN_NEXT_FALLBACK && targetProfileId) {
        // New sign-ups already know their slug from the insert; only the
        // existing-profile path needs an extra round-trip to fetch it.
        let slug: string | null | undefined = insertedSlug;
        if (!slug) {
          const { data: scopedProfile } = await supabaseAdmin
            .from("profiles")
            .select("slug")
            .eq("id", targetProfileId)
            .maybeSingle();
          slug = scopedProfile?.slug as string | null | undefined;
        }
        if (slug) finalNext = defaultLoginNext(slug);
      }

      return NextResponse.redirect(buildAppUrl(finalNext, request));
    }
  }

  return redirect("/auth/error");
}
