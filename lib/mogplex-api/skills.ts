/**
 * Skills over the v1 API: the caller's own catalog, optionally narrowed by a
 * repo they own. Listing returns summaries; the instructions come one skill
 * at a time, so a client pays for the text it will use.
 */
import { normalizeSkillToken } from "@/lib/skill-catalog/invocations";
import { searchSkills } from "@/lib/skill-catalog/search";
import { loadSkillCatalog } from "@/lib/skill-catalog/store";
import type { CatalogSkill, SkillCatalog } from "@/lib/skill-catalog/types";

export const MOGPLEX_API_SKILLS_DEFAULT_LIMIT = 50;
export const MOGPLEX_API_SKILLS_MAX_LIMIT = 200;

export type MogplexApiSkillSummary = {
  slug: string;
  name: string;
  description: string | null;
  tags: string[];
  /** `library` for the caller's own skill, `repo` for one the repo defines. */
  source: CatalogSkill["source"];
};

export type MogplexApiSkill = MogplexApiSkillSummary & { content: string };

export type MogplexApiSkillsDeps = {
  loadCatalog: (input: {
    userId: string;
    repoId?: string | null;
  }) => Promise<SkillCatalog>;
};

const defaultDeps: MogplexApiSkillsDeps = {
  loadCatalog: (input) => loadSkillCatalog(input),
};

function summarise(skill: CatalogSkill): MogplexApiSkillSummary {
  return {
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    tags: skill.tags,
    source: skill.source,
  };
}

export async function listMogplexApiSkills(
  input: {
    userId: string;
    repoId?: string | null;
    query?: string | null;
    limit?: number;
  },
  deps: MogplexApiSkillsDeps = defaultDeps
): Promise<{ skills: MogplexApiSkillSummary[]; total: number }> {
  const { skills } = await deps.loadCatalog({
    userId: input.userId,
    repoId: input.repoId ?? null,
  });
  const matches = searchSkills(
    skills,
    input.query,
    input.limit ?? MOGPLEX_API_SKILLS_DEFAULT_LIMIT
  );
  return { skills: matches.map(summarise), total: skills.length };
}

export async function getMogplexApiSkill(
  input: { userId: string; slug: string; repoId?: string | null },
  deps: MogplexApiSkillsDeps = defaultDeps
): Promise<MogplexApiSkill | null> {
  const { skills } = await deps.loadCatalog({
    userId: input.userId,
    repoId: input.repoId ?? null,
  });
  const wanted = normalizeSkillToken(input.slug);
  const skill = skills.find((entry) => entry.slug === wanted);
  return skill ? { ...summarise(skill), content: skill.content } : null;
}
