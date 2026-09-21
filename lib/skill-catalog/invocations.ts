/**
 * Finds the skills a user invoked by name in a message.
 *
 * Two spellings work on every surface:
 * - `/slug` as the first word of the message, the way a command is typed.
 * - `$slug` anywhere in the message. Slack swallows a leading slash as one of
 *   its own commands, so this is the spelling that survives there.
 *
 * A token only counts when the catalog has a skill with that slug, so `$HOME`
 * or `/compact` stay ordinary text unless the user named a skill that way.
 * Code spans and fenced blocks are skipped: shell snippets are full of `$VAR`.
 */
import type { CatalogSkill } from "./types";

const FENCED_CODE = /```[\S\s]*?(?:```|$)/g;
const INLINE_CODE = /`[^\n`]*`/g;
const LEADING_SLASH = /^\/([\da-z][\w-]*)(?=\s|$)/i;
const DOLLAR_MENTION = /(?<![\w$\\])\$([\da-z][\w-]*)/gi;

export type SkillInvocationOptions = {
  /**
   * Leading-slash names the surface already gives a meaning to (a CLI
   * harness's own `/compact`, for instance). They never resolve to a skill;
   * `$slug` still does.
   */
  reservedSlashNames?: ReadonlySet<string>;
};

/**
 * The one spelling of a handle: sigil dropped, lower case, underscores as
 * hyphens. Shared with `load_skill`, so a slug an agent passes resolves the
 * same way as one a user types.
 */
export function normalizeSkillToken(token: string) {
  return token
    .trim()
    .replace(/^[$/]/, "")
    .toLowerCase()
    .replaceAll("_", "-")
    .replace(/-+$/, "");
}

function stripCode(text: string) {
  return text.replace(FENCED_CODE, " ").replace(INLINE_CODE, " ");
}

/** Slugs the text names, in the order they appear, without duplicates. */
export function findSkillTokens(
  text: string,
  options: SkillInvocationOptions = {}
): string[] {
  const prose = stripCode(text).trim();
  const tokens: string[] = [];
  const leading = LEADING_SLASH.exec(prose);
  if (leading) {
    const name = normalizeSkillToken(leading[1]);
    if (!options.reservedSlashNames?.has(name)) tokens.push(name);
  }
  for (const match of prose.matchAll(DOLLAR_MENTION)) {
    tokens.push(normalizeSkillToken(match[1]));
  }
  return [...new Set(tokens.filter(Boolean))];
}

/**
 * The catalog skills invoked across one or more messages, first mention
 * first. Pass a conversation's user messages oldest to newest and a skill
 * invoked early stays in force for the turns that follow.
 */
export function resolveInvokedSkills(
  texts: string | readonly string[],
  skills: readonly CatalogSkill[],
  options: SkillInvocationOptions = {}
): CatalogSkill[] {
  if (skills.length === 0) return [];
  const bySlug = new Map(skills.map((skill) => [skill.slug, skill]));
  const invoked = new Map<string, CatalogSkill>();
  for (const text of typeof texts === "string" ? [texts] : texts) {
    for (const token of findSkillTokens(text, options)) {
      const skill = bySlug.get(token);
      if (skill && !invoked.has(skill.id)) invoked.set(skill.id, skill);
    }
  }
  return [...invoked.values()];
}
