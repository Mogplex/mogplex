/**
 * Skill discovery for the agent: search the user's catalog for a task, then
 * load the one that fits. The catalog is read once per run and shared by both
 * tools, so browsing costs a single query however often the agent looks.
 */
import { z } from "zod";
import type { Tool } from "ai";
import { normalizeSkillToken } from "@/lib/skill-catalog/invocations";
import { searchSkills } from "@/lib/skill-catalog/search";
import { loadSkillCatalog } from "@/lib/skill-catalog/store";
import type { CatalogSkill, SkillCatalog } from "@/lib/skill-catalog/types";
import { recordSkillUse, type RecordSkillUse } from "@/lib/skill-catalog/usage";
import { defineTool } from "./shared";

export const LOAD_SKILL_MAX_CHARS = 32_000;
const SUMMARY_MAX_CHARS = 300;

export type SkillToolContext = {
  userId: string;
  repoId?: string | null;
};

export type SkillToolDeps = {
  loadCatalog: (context: SkillToolContext) => Promise<SkillCatalog>;
  recordUse: RecordSkillUse;
};

const defaultSkillToolDeps: SkillToolDeps = {
  loadCatalog: (context) => loadSkillCatalog(context),
  recordUse: (userId, skills) => recordSkillUse(userId, skills),
};

const findSkillsParams = z.object({
  query: z
    .string()
    .max(500)
    .optional()
    .describe(
      "What the task involves, in a few words. Omit to list every skill."
    ),
  limit: z.number().int().min(1).max(50).default(10),
});

const loadSkillParams = z.object({
  slug: z
    .string()
    .min(1)
    .max(200)
    .describe("The skill's slug from find_skills, with or without its $."),
});

function summarise(skill: CatalogSkill) {
  const description = (skill.description ?? "").replace(/\s+/g, " ").trim();
  return {
    slug: skill.slug,
    name: skill.name,
    description:
      description.length > SUMMARY_MAX_CHARS
        ? `${description.slice(0, SUMMARY_MAX_CHARS - 1)}…`
        : description,
    tags: skill.tags,
    source: skill.source,
  };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function createSkillTools(
  context: SkillToolContext,
  deps: SkillToolDeps = defaultSkillToolDeps
): Record<string, Tool> {
  let catalogPromise: Promise<SkillCatalog> | null = null;
  const catalog = () => {
    catalogPromise ??= deps.loadCatalog(context).catch((error) => {
      // A failed read must not poison the rest of the run.
      catalogPromise = null;
      throw error;
    });
    return catalogPromise;
  };

  const find_skills = defineTool({
    description:
      "Search the user's skills: written procedures for recurring work in their projects. Check here before starting a task that may have an established way of being done, then call load_skill for the one that fits.",
    inputSchema: findSkillsParams,
    execute: async ({ query, limit }: z.infer<typeof findSkillsParams>) => {
      try {
        const { skills } = await catalog();
        const matches = searchSkills(skills, query, limit);
        return {
          ok: true,
          total: skills.length,
          count: matches.length,
          skills: matches.map(summarise),
        };
      } catch (error) {
        return { ok: false, error: errorMessage(error, "find_skills failed") };
      }
    },
  });

  const load_skill = defineTool({
    description:
      "Load a skill's full instructions by slug. Follow them for the work they cover.",
    inputSchema: loadSkillParams,
    execute: async ({ slug }: z.infer<typeof loadSkillParams>) => {
      try {
        const { skills } = await catalog();
        const wanted = normalizeSkillToken(slug);
        const skill = skills.find((entry) => entry.slug === wanted);
        if (!skill) {
          return {
            ok: false,
            error: `No skill with the slug "${wanted}".`,
            suggestions: searchSkills(
              skills,
              wanted.replaceAll("-", " "),
              5
            ).map((entry) => entry.slug),
          };
        }
        const content = skill.content.trim();
        await deps.recordUse(context.userId, [skill]);
        return {
          ok: true,
          skill: {
            ...summarise(skill),
            content: content.slice(0, LOAD_SKILL_MAX_CHARS),
            truncated: content.length > LOAD_SKILL_MAX_CHARS,
          },
        };
      } catch (error) {
        return { ok: false, error: errorMessage(error, "load_skill failed") };
      }
    },
  });

  return { find_skills, load_skill };
}
