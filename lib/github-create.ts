import type { GithubRepoPayload } from "@/lib/github-sync";

export type GithubRepoVisibility = "public" | "private";

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
