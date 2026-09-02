import { supabaseAdmin } from "@/lib/supabase/admin";
import { escapePostgrestLikePattern } from "@/lib/slack/slack-utils";
import type { SlackRepoContext } from "./types";

const REPO_SLUG_PATTERN =
  /\b([A-Za-z0-9](?:[A-Za-z0-9_.-]{0,38}[A-Za-z0-9])?)\/([A-Za-z0-9_.-]+)\b/g;
const GITHUB_REPO_URL_PATTERN =
  /(^|[^a-z0-9.-])(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s>|)]+)\/([^/\s?#>|)]+)[^\s>|)]*/gi;
const URL_LIKE_PATTERN =
  /\b(?:https?:\/\/|www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s>|)]*)?/gi;
const REPO_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,38}[A-Za-z0-9])?$/;
const REPO_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const ORG_PATTERN = /\b[Oo][Rr][Gg]\s*=\s*([A-Za-z0-9_.-]+)/;
const REPO_PATTERN = /\b[Rr][Ee][Pp][Oo]\s*=\s*([A-Za-z0-9_.-]+)/;
const MAX_REPO_CONTEXT_CANDIDATES = 10;
const BARE_REPO_NAME_TOKEN_PATTERN = /[A-Za-z0-9_.-]+/g;
const MAX_BARE_REPO_NAME_CANDIDATES = 40;
const MAX_BARE_REPO_NAME_MATCHES = 200;

type RepoRow = {
  id: string;
  full_name: string;
  default_branch: string | null;
  product_team_id: string | null;
  is_hidden: boolean | null;
};

function splitRepoFullName(fullName: string) {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function extractSlackRepoCandidates(texts: string[]): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const joined = texts.join("\n");

  const addCandidate = (owner: string, rawRepo: string) => {
    if (candidates.length >= MAX_REPO_CONTEXT_CANDIDATES) return;
    const repo = rawRepo.replace(/\.git$/i, "");
    if (!REPO_OWNER_PATTERN.test(owner) || !REPO_NAME_PATTERN.test(repo))
      return;
    const candidate = `${owner}/${repo}`;
    const key = candidate.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const textsWithoutGithubUrls = texts.map((text) =>
    text.replace(
      GITHUB_REPO_URL_PATTERN,
      (_match, prefix: string, owner: string, repo: string) => {
        addCandidate(owner, repo);
        return prefix;
      }
    )
  );

  const org = joined.match(ORG_PATTERN)?.[1];
  const repo = joined.match(REPO_PATTERN)?.[1];
  if (org && repo) {
    addCandidate(org, repo);
  }

  for (const text of textsWithoutGithubUrls) {
    const textWithoutUrls = text.replace(URL_LIKE_PATTERN, " ");
    for (const match of textWithoutUrls.matchAll(REPO_SLUG_PATTERN)) {
      addCandidate(match[1], match[2]);
    }
  }

  return candidates;
}

/**
 * Bare repository names ("fix this in widgets") that could identify one of the
 * user's connected repositories when no owner/repo slug or GitHub URL is
 * present. Tokens are deduplicated case-insensitively in order of appearance,
 * so callers should pass the newest text first.
 */
export function extractSlackBareRepoNameCandidates(texts: string[]): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    const withoutUrls = text
      .replace(GITHUB_REPO_URL_PATTERN, "$1")
      .replace(URL_LIKE_PATTERN, " ");
    for (const match of withoutUrls.matchAll(BARE_REPO_NAME_TOKEN_PATTERN)) {
      if (candidates.length >= MAX_BARE_REPO_NAME_CANDIDATES) return candidates;
      const token = match[0].replace(/^[._-]+|[._-]+$/g, "");
      if (token.length < 3 || !/[A-Za-z]/.test(token)) continue;
      if (!REPO_NAME_PATTERN.test(token)) continue;
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(token);
    }
  }
  return candidates;
}

function toSlackRepoContext(repoRow: RepoRow): SlackRepoContext | null {
  const split = splitRepoFullName(repoRow.full_name);
  if (!split) return null;
  return {
    repoId: repoRow.id,
    repoFullName: repoRow.full_name,
    repoOwner: split.owner,
    repoName: split.repo,
    repoBaseBranch: repoRow.default_branch ?? null,
    teamId: repoRow.product_team_id ?? null,
  };
}

async function queryVisibleRepos(input: {
  mogplexUserId: string;
  filter: string;
  limit: number;
  candidateCount: number;
}): Promise<RepoRow[] | null> {
  const { data, error } = await supabaseAdmin
    .from("repos")
    .select("id, full_name, default_branch, product_team_id, is_hidden")
    .eq("user_id", input.mogplexUserId)
    .or(input.filter)
    .limit(input.limit);
  if (error) {
    console.warn("[slack-event] failed to resolve repo context", {
      candidateCount: input.candidateCount,
      error,
    });
    return null;
  }
  return (data ?? []).filter((repo) => repo.is_hidden !== true);
}

async function resolveRepoContextBySlug(input: {
  mogplexUserId: string;
  texts: string[];
}): Promise<SlackRepoContext | null> {
  const candidates = extractSlackRepoCandidates(input.texts);
  if (candidates.length === 0) return null;

  const repos = await queryVisibleRepos({
    mogplexUserId: input.mogplexUserId,
    filter: candidates
      .map(
        (candidate) =>
          `full_name.ilike.${escapePostgrestLikePattern(candidate)}`
      )
      .join(","),
    limit: MAX_REPO_CONTEXT_CANDIDATES,
    candidateCount: candidates.length,
  });
  if (!repos) return null;

  const visibleByFullName = new Map(
    repos.map((repo) => [repo.full_name.toLowerCase(), repo] as const)
  );
  for (const candidate of candidates) {
    const repoRow = visibleByFullName.get(candidate.toLowerCase());
    if (!repoRow) continue;
    const context = toSlackRepoContext(repoRow);
    if (context) return context;
  }
  return null;
}

/**
 * Fallback for messages that name a repository without its owner. Only an
 * unambiguous match counts: a bare name shared by two connected repositories
 * (forks, say) is skipped rather than guessed.
 */
async function resolveRepoContextByBareName(input: {
  mogplexUserId: string;
  texts: string[];
}): Promise<SlackRepoContext | null> {
  const candidates = extractSlackBareRepoNameCandidates(input.texts);
  if (candidates.length === 0) return null;

  const repos = await queryVisibleRepos({
    mogplexUserId: input.mogplexUserId,
    filter: candidates
      .map(
        (candidate) =>
          `full_name.ilike.%/${escapePostgrestLikePattern(candidate)}`
      )
      .join(","),
    limit: MAX_BARE_REPO_NAME_MATCHES,
    candidateCount: candidates.length,
  });
  if (!repos) return null;

  const reposByName = new Map<string, RepoRow[]>();
  for (const repo of repos) {
    const split = splitRepoFullName(repo.full_name);
    if (!split) continue;
    const key = split.repo.toLowerCase();
    reposByName.set(key, [...(reposByName.get(key) ?? []), repo]);
  }
  for (const candidate of candidates) {
    const matches = reposByName.get(candidate.toLowerCase());
    if (matches?.length !== 1) continue;
    const context = toSlackRepoContext(matches[0]);
    if (context) return context;
  }
  return null;
}

export async function defaultResolveSlackRepoContext(input: {
  mogplexUserId: string;
  texts: string[];
}): Promise<SlackRepoContext | null> {
  const bySlug = await resolveRepoContextBySlug(input);
  if (bySlug) return bySlug;
  return resolveRepoContextByBareName(input);
}
