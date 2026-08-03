import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { buildAppUrl } from "@/lib/app-url";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

async function signOutCurrentSession() {
  if (process.env.MOGPLEX_DATA_BACKEND === "neon") {
    const { auth } = await import("@/lib/better-auth/server");
    try {
      await auth.api.signOut({ headers: await headers() });
    } catch {
      // No active session — nothing to revoke; the caller's redirect still
      // lands the user on /login signed out.
    }
  } else {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  const cookieStore = await cookies();
  cookieStore.delete("user_id");
}

export async function POST() {
  await signOutCurrentSession();
  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  await signOutCurrentSession();
  return NextResponse.redirect(buildAppUrl("/login", request));
}
