/**
 * Reads a registry skill's real instructions: the SKILL.md in its source
 * repository. The skills.sh page is a listing, and scraping its first code
 * block yields an install command or a stray URL, not the skill.
 */

export type RegistrySkillMarkdown = {
  /** The instructions, without the frontmatter block. */
  content: string;
  name: string | null;
  description: string | null;
  /** Where it was read from, for the installed skill's provenance line. */
  url: string;
};

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const RAW_HOST = "https://raw.githubusercontent.com";
const SEGMENT = /^[\w.-]+$/;
export const REGISTRY_SKILL_MAX_CHARS = 200_000;
const FETCH_TIMEOUT_MS = 8000;

function safeSegments(value: string): string[] | null {
  const segments = value.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  // `..` passes the character class, so it is refused by name.
  if (segments.some((part) => !SEGMENT.test(part) || part === "..")) {
    return null;
  }
  return segments;
}

/**
 * Candidate SKILL.md locations, most common layout first. `source` is
 * `owner/repo`; `skillId` may be nested (`group/skill`).
 */
export function registrySkillMarkdownUrls(
  source: string,
  skillId: string
): string[] {
  const repo = safeSegments(source);
  const skill = safeSegments(skillId);
  if (repo?.length !== 2 || !skill) return [];
  const base = `${RAW_HOST}/${repo.join("/")}/HEAD`;
  const id = skill.join("/");
  return [
    `${base}/skills/${id}/SKILL.md`,
    `${base}/${id}/SKILL.md`,
    `${base}/.claude/skills/${id}/SKILL.md`,
    `${base}/.agents/skills/${id}/SKILL.md`,
  ];
}

const FRONTMATTER = /^---\r?\n([\S\s]*?)\r?\n---\r?\n?/;

function frontmatterValue(block: string, key: string): string | null {
  const match = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(block);
  if (!match) return null;
  const value = match[1]
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2")
    .trim();
  return value || null;
}

export function parseSkillMarkdown(markdown: string) {
  const match = FRONTMATTER.exec(markdown);
  if (!match)
    return { content: markdown.trim(), name: null, description: null };
  return {
    content: markdown.slice(match[0].length).trim(),
    name: frontmatterValue(match[1], "name"),
    description: frontmatterValue(match[1], "description"),
  };
}

/**
 * The first candidate that exists and has a body, or null. Never rejects: an
 * install falls back to the listing page rather than failing.
 */
export async function fetchRegistrySkillMarkdown(
  input: { source: string; skillId: string },
  fetchImpl: FetchLike = fetch
): Promise<RegistrySkillMarkdown | null> {
  for (const url of registrySkillMarkdownUrls(input.source, input.skillId)) {
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": "MOGPLEX/1.0" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const parsed = parseSkillMarkdown(
        (await res.text()).slice(0, REGISTRY_SKILL_MAX_CHARS)
      );
      if (parsed.content) return { ...parsed, url };
    } catch {
      // Try the next layout; a network failure here must not fail an install.
    }
  }
  return null;
}
