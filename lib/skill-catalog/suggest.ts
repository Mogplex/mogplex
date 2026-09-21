/**
 * Completion for a skill handle while the user types it. Mirrors what
 * `findSkillTokens` will read once the message is sent: `/` only opens a
 * handle as the first word, `$` opens one anywhere.
 */
export type SuggestableSkill = {
  slug: string;
  name: string;
  description: string | null;
};

export type SkillSuggestions<T extends SuggestableSkill> = {
  /** The partial handle being typed, sigil included. */
  token: string;
  matches: T[];
};

const TRAILING_TOKEN = /(^|\s)([$/][\w-]*)$/;
const MAX_SUGGESTIONS = 8;

export function getSkillSuggestions<T extends SuggestableSkill>(
  value: string,
  skills: readonly T[]
): SkillSuggestions<T> | null {
  const match = TRAILING_TOKEN.exec(value);
  if (!match) return null;
  const token = match[2];
  const leadsMessage = value.trimStart().length === token.length;
  if (token.startsWith("/") && !leadsMessage) return null;
  const typed = token.slice(1).toLowerCase().replaceAll("_", "-");
  const matches = skills
    .filter(
      (skill) =>
        skill.slug.startsWith(typed) ||
        (typed.length > 0 && skill.name.toLowerCase().includes(typed))
    )
    // A finished handle needs no menu.
    .filter((skill) => skill.slug !== typed)
    .slice(0, MAX_SUGGESTIONS);
  return matches.length > 0 ? { token, matches } : null;
}

/** Replaces the partial handle with the chosen slug, keeping its sigil. */
export function applySkillSuggestion(value: string, slug: string): string {
  const match = TRAILING_TOKEN.exec(value);
  if (!match) return value;
  const token = match[2];
  return `${value.slice(0, value.length - token.length)}${token[0]}${slug} `;
}
