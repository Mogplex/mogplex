import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAppUrl } from "@/lib/app-url";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete("user_id");
  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete("user_id");
  return NextResponse.redirect(buildAppUrl("/login", request));
}
