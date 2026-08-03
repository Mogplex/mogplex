// Profile provisioning for better-auth sign-ups. The Supabase flow created
// profiles in the GitHub OAuth callback; better-auth creates users for email
// and social flows alike, so the profile row is provisioned from the
// user-create database hook instead. Existing users migrated from Supabase
// keep their profiles (the data copy preserves auth uids, so the hook only
// fires for genuinely new users).
import { insertProfileWithUniqueSlug } from "@/lib/profile-slug";

export type BetterAuthUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export async function createProfileForBetterAuthUser(
  user: BetterAuthUser
): Promise<void> {
  // Lazy import keeps lib/better-auth/server importable without Supabase env
  // (its module-load stays side-effect-free; supabaseAdmin constructs a
  // client at load time when the backend is Supabase).
  const { supabaseAdmin } = await import("@/lib/supabase/admin");

  // Idempotence: a retried hook or a pre-provisioned profile (data copy)
  // must not produce duplicates.
  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (existing?.id) return;

  const result = await insertProfileWithUniqueSlug(
    supabaseAdmin,
    {
      id: crypto.randomUUID(),
      auth_user_id: user.id,
      // auth_provider is CHECK-constrained to github/vercel/null; better-auth
      // sign-ups (email or social) stay null until that migration lands.
      auth_provider: null,
      last_auth_at: new Date().toISOString(),
      name: user.name || null,
      email: user.email || null,
      avatar_url: user.image || null,
    },
    { email: user.email ?? null }
  );

  if (!result.ok) {
    // Surface loudly: better-auth rolls nothing back here, but a user without
    // a profile cannot enter the dashboard, and the sign-in path logs guide
    // the repair.
    throw new Error(
      `profile provisioning failed for better-auth user ${user.id}: ${result.error.message}`
    );
  }
}
