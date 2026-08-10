import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SlackRepoContext } from "./types";

const REPO_SLUG_PATTERN =
  /\b([A-Za-z0-9](?:[A-Za-z0-9_.-]{0,38}[A-Za-z0-9])?)\/([A-Za-z0-9_.-]+)\b/g;
const ORG_PATTERN = /\b[Oo][Rr][Gg]\s*=\s*([A-Za-z0-9_.-]+)/;
const REPO_PATTERN = /\b[Rr][Ee][Pp][Oo]\s*=\s*([A-Za-z0-9_.-]+)/;

function splitRepoFullName(fullName: string) {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function extractSlackRepoCandidates(texts: string[]): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const joined = texts.join("\n");

  for (const text of texts) {
    for (const match of text.matchAll(REPO_SLUG_PATTERN)) {
      const candidate = `${match[1]}/${match[2]}`;
      const key = candidate.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(candidate);
      }
    }
  }

  const org = joined.match(ORG_PATTERN)?.[1];
  const repo = joined.match(REPO_PATTERN)?.[1];
  if (org && repo) {
    const candidate = `${org}/${repo}`;
    const key = candidate.toLowerCase();
    if (!seen.has(key)) candidates.push(candidate);
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
      .ilike("full_name", candidate)
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
