/**
 * The skill catalog: every skill a run may draw on, independent of which
 * surface started the run. A user's library skills apply everywhere; a repo
 * can exclude some of them and add skills of its own.
 */

/** Where a catalog skill comes from. */
export type CatalogSkillSource = "library" | "repo";

export type CatalogSkill = {
  /** `skills.id` for a library skill, `repo_skill_overrides.id` for a repo one. */
  id: string;
  /** Stable handle a user types to invoke the skill: `/slug` or `$slug`. */
  slug: string;
  name: string;
  description: string | null;
  content: string;
  tags: string[];
  source: CatalogSkillSource;
};

/** A skill row before it is given a slug. */
export type CatalogSkillRow = Omit<CatalogSkill, "slug">;

export type SkillCatalog = {
  skills: CatalogSkill[];
};

export const EMPTY_SKILL_CATALOG: SkillCatalog = { skills: [] };
