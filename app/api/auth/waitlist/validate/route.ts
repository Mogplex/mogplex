import { NextResponse } from "next/server";

// Legacy access-code gate for the retired Supabase sign-in flow.
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "legacy_login_retired",
      message: "Sign in at /login.",
    },
    { status: 410 }
  );
}
