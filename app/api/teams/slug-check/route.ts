import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isReservedSlug } from "@/lib/reserved-slugs";
import { isValidScopeSlug } from "@/lib/team-slug";

export type SlugCheckResponse = {
  available: boolean;
  reason?: "invalid" | "reserved" | "taken";
};

export async function GET(request: Request) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const url = new URL(request.url);
  const slug = (url.searchParams.get("slug") || "").trim().toLowerCase();

  if (!slug || !isValidScopeSlug(slug)) {
    return NextResponse.json<SlugCheckResponse>({
      available: false,
      reason: "invalid",
    });
  }
  if (isReservedSlug(slug)) {
    return NextResponse.json<SlugCheckResponse>({
      available: false,
      reason: "reserved",
    });
  }

  // Cross-table check against teams + profiles. Service-role bypasses RLS so
  // we get the same answer assert_slug_available() would give on insert.
  const [teamHit, profileHit] = await Promise.all([
    supabaseAdmin
      .from("teams")
      .select("id", { head: true, count: "exact" })
      .eq("slug", slug),
    supabaseAdmin
      .from("profiles")
      .select("id", { head: true, count: "exact" })
      .eq("slug", slug),
  ]);

  if ((teamHit.count ?? 0) > 0 || (profileHit.count ?? 0) > 0) {
    return NextResponse.json<SlugCheckResponse>({
      available: false,
      reason: "taken",
    });
  }

  return NextResponse.json<SlugCheckResponse>({ available: true });
}
