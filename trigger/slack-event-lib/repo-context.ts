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

export async function defaultResolveSlackRepoContext(input: {
  mogplexUserId: string;
  texts: string[];
}): Promise<SlackRepoContext | null> {
  const candidates = extractSlackRepoCandidates(input.texts);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const { data, error } = await supabaseAdmin
      .from("repos")
      .select("id, full_name, default_branch, product_team_id")
      .eq("user_id", input.mogplexUserId)
      .ilike("full_name", escapePostgrestLikePattern(candidate))
      .or("is_hidden.is.null,is_hidden.eq.false")
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[slack-event] failed to resolve repo context", {
        candidate,
        error,
      });
      continue;
    }
    if (!data) continue;
    const split = splitRepoFullName(data.full_name);
    if (!split) continue;
    return {
      repoId: data.id,
      repoFullName: data.full_name,
      repoOwner: split.owner,
      repoName: split.repo,
      repoBaseBranch: data.default_branch ?? null,
      teamId: data.product_team_id ?? null,
    };
  }

  return null;
}
