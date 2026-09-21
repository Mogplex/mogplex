/**
 * Renders the skill catalog into prompt text and sandbox files.
 *
 * Two sections, both optional:
 * - Invoked skills: the ones the user named. Their full text reaches the
 *   agent, inline or as files it is told to read first.
 * - Available skills: a one-line index of the rest, so the agent can decide
 *   on its own that a task calls for one and load it.
 */
import type { CatalogSkill } from "./types";

export const CATALOG_SKILLS_DIR = ".mogplex/skills";
export const INVOKED_SKILLS_MAX_CHARS = 32_000;
export const SKILL_INDEX_MAX_ENTRIES = 60;
const INDEX_DESCRIPTION_MAX_CHARS = 200;
const TRUNCATION_MARKER = "\n[truncated]";

export type SkillDelivery = "files" | "inline";

/** How the agent on this surface fetches a skill it was not handed. */
export type SkillLoadHint = "tool" | "files" | "none";

export type SkillCatalogFile = { path: string; content: string };

export type RenderedSkillCatalog = {
  /** Prompt block, or null when there is nothing to say. */
  prompt: string | null;
  /** Files to write into the sandbox checkout. Empty for inline delivery. */
  files: SkillCatalogFile[];
};

export function catalogSkillPath(skill: Pick<CatalogSkill, "slug">) {
  return `${CATALOG_SKILLS_DIR}/${skill.slug}/SKILL.md`;
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`;
}

function oneLine(value: string | null, max: number) {
  const flat = (value ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

function withTrailingNewline(content: string) {
  const trimmed = content.trim();
  return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
}

function renderInvoked(
  skills: readonly CatalogSkill[],
  delivery: SkillDelivery
) {
  if (skills.length === 0) return null;
  const intro =
    "The user invoked these skills by name. Follow them for this request.";
  if (delivery === "files") {
    const lines = skills.map((skill) =>
      skill.content.trim()
        ? `- ${skill.name} (${catalogSkillPath(skill)})`
        : `- ${skill.name} (no instructions written yet)`
    );
    return [
      "## Invoked skills",
      `${intro} Read each file before you start.`,
      lines.join("\n"),
    ].join("\n\n");
  }
  let budget = INVOKED_SKILLS_MAX_CHARS;
  const sections = skills.map((skill) => {
    const header = `### ${skill.name} ($${skill.slug})`;
    const content = skill.content.trim();
    if (!content) return header;
    if (budget <= 0) return `${header}\n[omitted: skill budget exhausted]`;
    const body = truncate(content, budget);
    budget -= body.length;
    return `${header}\n\n${body}`;
  });
  return ["## Invoked skills", intro, ...sections].join("\n\n");
}

const LOAD_HINT_TEXT: Record<SkillLoadHint, string | null> = {
  tool: "Call load_skill with a skill's slug before doing work it covers, and find_skills to search by task.",
  files: `Each skill is a file under ${CATALOG_SKILLS_DIR}/<slug>/SKILL.md in this checkout. Read a skill before doing work it covers.`,
  none: null,
};

function renderIndex(skills: readonly CatalogSkill[], hint: SkillLoadHint) {
  if (skills.length === 0 || hint === "none") return null;
  const listed = skills.slice(0, SKILL_INDEX_MAX_ENTRIES);
  const lines = listed.map((skill) => {
    const summary = oneLine(skill.description, INDEX_DESCRIPTION_MAX_CHARS);
    return `- $${skill.slug}: ${skill.name}${summary ? ` — ${summary}` : ""}`;
  });
  const more = skills.length - listed.length;
  if (more > 0) {
    lines.push(
      hint === "tool"
        ? `- …and ${more} more. Use find_skills to search them.`
        : `- …and ${more} more. Ask the user to invoke one by its $slug.`
    );
  }
  return [
    "## Available skills",
    `The user keeps these skills. ${LOAD_HINT_TEXT[hint]}`,
    lines.join("\n"),
  ].join("\n\n");
}

/**
 * Builds the skills block for a prompt. `invoked` skills are delivered in
 * full; the remaining `available` skills are indexed when the surface gives
 * the agent a way to load one (`loadHint`).
 */
export function renderSkillCatalog(input: {
  invoked: readonly CatalogSkill[];
  available: readonly CatalogSkill[];
  delivery: SkillDelivery;
  loadHint: SkillLoadHint;
}): RenderedSkillCatalog {
  const invokedIds = new Set(input.invoked.map((skill) => skill.id));
  const rest = input.available.filter((skill) => !invokedIds.has(skill.id));
  const parts = [
    renderInvoked(input.invoked, input.delivery),
    renderIndex(rest, input.loadHint),
  ].filter(Boolean);
  const prompt =
    parts.length > 0 ? `<skills>\n${parts.join("\n\n")}\n</skills>` : null;
  // Only indexed skills are written: a file the prompt never names is one the
  // agent cannot find, and a large library should not flood the checkout.
  const fileSkills =
    input.delivery === "files"
      ? [
          ...input.invoked,
          ...(input.loadHint === "files"
            ? rest.slice(0, SKILL_INDEX_MAX_ENTRIES)
            : []),
        ]
      : [];
  const files = fileSkills
    .filter((skill) => skill.content.trim().length > 0)
    .map((skill) => ({
      path: catalogSkillPath(skill),
      content: withTrailingNewline(skill.content),
    }));
  return { prompt, files };
}
