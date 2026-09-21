/**
 * Ranks catalog skills against a free-text query. Plain word overlap, weighted
 * by where the word lands: a hit in the name or slug says more than a hit
 * somewhere in the body. Good enough for a library a person curates by hand,
 * and it keeps discovery free of a model call.
 */
import type { CatalogSkill } from "./types";

const NAME_WEIGHT = 6;
const TAG_WEIGHT = 4;
const DESCRIPTION_WEIGHT = 3;
const CONTENT_WEIGHT = 1;
const EXACT_SLUG_BONUS = 20;
const WORD = /[\da-z]+/g;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "to",
  "of",
  "for",
  "in",
  "on",
  "with",
  "how",
  "do",
  "i",
  "my",
  "is",
  "it",
  "this",
  "that",
  "skill",
  "skills",
]);

function words(value: string | null | undefined): string[] {
  return (value ?? "").toLowerCase().match(WORD) ?? [];
}

function queryWords(query: string): string[] {
  const all = [...new Set(words(query))];
  const meaningful = all.filter((word) => !STOP_WORDS.has(word));
  return meaningful.length > 0 ? meaningful : all;
}

function countMatches(haystack: ReadonlySet<string>, needles: string[]) {
  let hits = 0;
  for (const needle of needles) {
    if (haystack.has(needle)) hits += 1;
  }
  return hits;
}

export function scoreSkill(skill: CatalogSkill, query: string): number {
  const needles = queryWords(query);
  if (needles.length === 0) return 0;
  const name = new Set([...words(skill.name), ...words(skill.slug)]);
  const tags = new Set(skill.tags.flatMap((tag) => words(tag)));
  const description = new Set(words(skill.description));
  const content = new Set(words(skill.content));
  const exact =
    query.trim().toLowerCase().replace(/^[$/]/, "") === skill.slug
      ? EXACT_SLUG_BONUS
      : 0;
  return (
    exact +
    countMatches(name, needles) * NAME_WEIGHT +
    countMatches(tags, needles) * TAG_WEIGHT +
    countMatches(description, needles) * DESCRIPTION_WEIGHT +
    countMatches(content, needles) * CONTENT_WEIGHT
  );
}

/**
 * Skills that match the query, best first. A blank query lists the catalog in
 * its own order, which is how an agent browses when it has no words yet.
 */
export function searchSkills(
  skills: readonly CatalogSkill[],
  query: string | null | undefined,
  limit = 10
): CatalogSkill[] {
  const trimmed = query?.trim() ?? "";
  if (!trimmed) return skills.slice(0, limit);
  return skills
    .map((skill, index) => ({
      skill,
      index,
      score: scoreSkill(skill, trimmed),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.skill);
}
