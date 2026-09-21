import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { loadSkillCatalog } from "@/lib/skill-catalog/store";
import { isUuid } from "@/lib/uuid";

export type SkillCatalogEntry = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  source: "library" | "repo";
};

/**
 * The signed-in user's skills as a run would see them, with the slug each
 * one answers to. Composers use it to complete `/slug` and `$slug`; the
 * library uses it to show a skill's handle. Instructions are left out.
 */
export function createSkillCatalogGetHandler(
  overrides: {
    requireUserId?: typeof requireUserId;
    loadCatalog?: typeof loadSkillCatalog;
  } = {}
) {
  const requireUser = overrides.requireUserId ?? requireUserId;
  const loadCatalog = overrides.loadCatalog ?? loadSkillCatalog;
  return async function GET(req: Request) {
    const userId = await requireUser();
    if (userId instanceof Response) return userId;

    const repoId = new URL(req.url).searchParams.get("repoId");
    if (repoId && !isUuid(repoId)) {
      return NextResponse.json({ error: "Invalid repoId" }, { status: 400 });
    }
    try {
      const { skills } = await loadCatalog({ userId, repoId });
      const entries: SkillCatalogEntry[] = skills.map((skill) => ({
        id: skill.id,
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        source: skill.source,
      }));
      return NextResponse.json({ skills: entries });
    } catch (error) {
      console.error("[skills/catalog] failed to load", error);
      return NextResponse.json(
        { error: "Failed to load skills" },
        { status: 500 }
      );
    }
  };
}

export const GET = createSkillCatalogGetHandler();
