import { isReservedSlug } from "@/lib/reserved-slugs";

export type ScopeLookup = {
  findProfileBySlug: (slug: string) => Promise<{ id: string } | null>;
  findTeamBySlug: (slug: string) => Promise<{ id: string } | null>;
  isTeamMember: (teamId: string, userId: string) => Promise<boolean>;
};

export type ResolvedScope =
  | { status: "not_found" }
  | { status: "redirect_login" }
  | { status: "personal"; slug: string; profileId: string }
  | { status: "team"; slug: string; teamId: string };

// Pure resolver — extracted from middleware.ts so the auth/access logic
// is unit-testable without NextRequest/NextResponse plumbing.
//
// Order matters: reserved-slug + slug-existence are evaluated before the
// auth check so the "don't reveal which slugs exist" property holds for
// unauthed callers too.
export async function resolveScope(
  slug: string,
  userId: string | null,
  db: ScopeLookup
): Promise<ResolvedScope> {
  if (isReservedSlug(slug)) return { status: "not_found" };

  const [profile, team] = await Promise.all([
    db.findProfileBySlug(slug),
    db.findTeamBySlug(slug),
  ]);

  if (!profile && !team) return { status: "not_found" };

  if (!userId) return { status: "redirect_login" };

  // Personal wins on collision (locked decision in #557 sprint notes).
  if (profile) {
    if (profile.id !== userId) return { status: "not_found" };
    return { status: "personal", slug, profileId: profile.id };
  }

  const teamRow = team!;
  const member = await db.isTeamMember(teamRow.id, userId);
  if (!member) return { status: "not_found" };
  return { status: "team", slug, teamId: teamRow.id };
}
