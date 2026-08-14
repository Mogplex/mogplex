import type { GithubRepoPayload } from "@/lib/github-sync";

export type GithubRepoVisibility = "public" | "private";
export type GithubRepoAvailability = "available" | "taken" | "unverified";

const GITHUB_CREATE_RECOVERY_WINDOW_MS = 10 * 60 * 1000;

export class GithubRepoCreateError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`GitHub repo creation failed (${status}): ${body}`);
    this.status = status;
    this.body = body;
  }
}

export async function createGithubRepo(
  token: string,
  input: {
    owner: string | null;
    name: string;
    description?: string | null;
    visibility?: GithubRepoVisibility;
  }
) {
  const owner =
    typeof input.owner === "string" && input.owner.trim()
      ? input.owner.trim()
      : null;
  const visibility = input.visibility === "public" ? "public" : "private";
  const endpoint = owner
    ? `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos`
    : "https://api.github.com/user/repos";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      name: input.name,
      description: input.description || undefined,
      private: visibility === "private",
      auto_init: true,
    }),
  });

  if (!response.ok) {
    throw new GithubRepoCreateError(response.status, await response.text());
  }

  return response.json() as Promise<GithubRepoPayload>;
}

export async function checkGithubRepoAvailability(
  token: string,
  owner: string,
  name: string
): Promise<GithubRepoAvailability> {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    }
  );

  if (response.status === 404) return "available";
  if (response.ok) return "taken";
  if (response.status === 403 || response.status === 429) return "unverified";

  throw new Error(
    `GitHub repo availability check failed (${response.status}): ${await response.text()}`
  );
}

export async function fetchGithubRepo(
  token: string,
  owner: string,
  name: string
): Promise<GithubRepoPayload | null> {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `GitHub repo lookup failed (${response.status}): ${await response.text()}`
    );
  }
  return response.json() as Promise<GithubRepoPayload>;
}

export function isRecoverableGithubRepoCreateConflict(
  repo: GithubRepoPayload,
  now = Date.now()
) {
  const createdAt = Date.parse(repo.created_at ?? "");
  return (
    Number.isFinite(createdAt) &&
    createdAt <= now &&
    now - createdAt <= GITHUB_CREATE_RECOVERY_WINDOW_MS &&
    typeof repo.size === "number" &&
    repo.size >= 0 &&
    repo.size <= 1
  );
}

export function extractGithubApiErrorMessage(body: string) {
  try {
    const parsed = JSON.parse(body) as {
      message?: string;
      errors?: Array<{ message?: string }>;
    };
    const primary =
      typeof parsed.message === "string" && parsed.message.trim()
        ? parsed.message.trim()
        : null;
    const detail =
      parsed.errors
        ?.find(
          (entry) => typeof entry.message === "string" && entry.message.trim()
        )
        ?.message?.trim() || null;
    return [primary, detail].filter(Boolean).join(": ");
  } catch {
    return body.trim();
  }
}
