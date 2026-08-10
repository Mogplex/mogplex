import { z } from "zod";
import { defineTool } from "./shared";
import { normalizeLogin, findInstallationToken } from "./github-shared";

const GITHUB_API_ORIGIN = "https://api.github.com";
const MAX_INSTALLATION_AUTHS = 5;

export type GithubRepoListOptions = {
  oauthToken?: string | null;
  userId?: string | null;
};

type RepoListAuth = {
  token: string;
  source: "oauth" | "github_app_installation";
};

type GithubRepo = {
  full_name?: string;
  private?: boolean;
  description?: string | null;
  language?: string | null;
  default_branch?: string;
  updated_at?: string;
  html_url?: string;
  owner?: { login?: string };
};

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mogplex-agent",
  };
}

function unavailableError(warnings: string[] = []) {
  return {
    error:
      "Authenticated GitHub repo listing is unavailable. Connect GitHub OAuth or install the Mogplex GitHub App for the requested owner.",
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

async function fetchJson(
  path: string,
  auth: RepoListAuth
): Promise<{ ok: true; body: unknown } | { ok: false; warning: string }> {
  try {
    const res = await fetch(`${GITHUB_API_ORIGIN}${path}`, {
      headers: githubHeaders(auth.token),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        warning: `${auth.source} repo listing failed with status ${res.status}; tried the next available credential.`,
      };
    }
    return { ok: true, body: await res.json() };
  } catch (error) {
    return {
      ok: false,
      warning: `${auth.source} repo listing failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

function extractRepos(auth: RepoListAuth, body: unknown): GithubRepo[] {
  if (auth.source === "github_app_installation") {
    const repos = (body as { repositories?: GithubRepo[] })?.repositories;
    return Array.isArray(repos) ? repos : [];
  }
  return Array.isArray(body) ? (body as GithubRepo[]) : [];
}

function mapRepo(repo: GithubRepo) {
  return {
    fullName: repo.full_name ?? null,
    private: repo.private ?? null,
    description: repo.description ?? null,
    language: repo.language ?? null,
    defaultBranch: repo.default_branch ?? null,
    updatedAt: repo.updated_at ?? null,
    url: repo.html_url ?? null,
  };
}

function matchesFilters(
  repo: GithubRepo,
  filters: { owner: string | null; query: string | null; visibility: string }
) {
  const fullName = repo.full_name ?? "";
  if (
    filters.owner &&
    repo.owner?.login?.toLowerCase() !== filters.owner.toLowerCase()
  )
    return false;
  if (
    filters.query &&
    !fullName.toLowerCase().includes(filters.query.toLowerCase())
  )
    return false;
  if (filters.visibility === "public" && repo.private) return false;
  if (filters.visibility === "private" && repo.private === false) return false;
  return true;
}

/**
 * Auth candidates: a GitHub App installation token per accessible
 * installation (just the requested owner's when scoped), plus the user's
 * OAuth token as fallback. Installation tokens cover private repos the app
 * can access; OAuth covers everything the user can see.
 */
async function resolveAuths(input: {
  oauthToken?: string | null;
  userId?: string | null;
  owner: string | null;
}): Promise<{ auths: RepoListAuth[]; warnings: string[] }> {
  const auths: RepoListAuth[] = [];
  const warnings: string[] = [];

  if (input.userId && input.owner) {
    try {
      const token = await findInstallationToken({
        userId: input.userId,
        owner: input.owner,
      });
      if (token) auths.push({ token, source: "github_app_installation" });
    } catch (error) {
      warnings.push(
        `GitHub App installation lookup failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  } else if (input.userId) {
    try {
      const { supabaseAdmin } = await import("@/lib/supabase/admin");
      const { hasGithubAppConfig, createGithubInstallationAccessToken } =
        await import("@/lib/github-app");
      if (hasGithubAppConfig()) {
        const { data, error } = await supabaseAdmin
          .from("github_installations")
          .select("installation_id, account_login")
          .eq("user_id", input.userId)
          .limit(MAX_INSTALLATION_AUTHS);
        if (error) throw new Error(error.message);
        for (const row of data ?? []) {
          if (!row.installation_id) continue;
          const { token } = await createGithubInstallationAccessToken(
            row.installation_id
          );
          auths.push({ token, source: "github_app_installation" });
        }
      }
    } catch (error) {
      warnings.push(
        `GitHub App installation lookup failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  const oauthToken = input.oauthToken?.trim();
  if (oauthToken) auths.push({ token: oauthToken, source: "oauth" });
  return { auths, warnings };
}

const repoListParams = z
  .object({
    owner: z
      .string()
      .optional()
      .describe(
        "GitHub organization or user login to scope the listing, e.g. 'mogplex'. Omit to list repos across every connected installation and the user's OAuth account."
      ),
    query: z
      .string()
      .optional()
      .describe("Optional substring filter on the repo full name."),
    visibility: z
      .enum(["all", "public", "private"])
      .default("all")
      .describe("Repo visibility filter."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(30)
      .describe("Maximum repos to return."),
  })
  .strict();

export function createGithubRepoList(options: GithubRepoListOptions = {}) {
  return defineTool({
    description:
      "List GitHub repositories visible to the connected GitHub account, including private repositories covered by the Mogplex GitHub App installation or the user's OAuth connection. Read-only. Use this for 'what repos do I have access to', org repo inventory, or finding a repo by name. Never use unauthenticated web_fetch against api.github.com for repo inventory — it only returns public data.",
    inputSchema: repoListParams,
    execute: async ({
      owner,
      query,
      visibility,
      limit,
    }: z.infer<typeof repoListParams>) => {
      const ownerResult = normalizeLogin(owner, "owner");
      if ("error" in ownerResult) return { error: ownerResult.error };
      const filters = {
        owner: ownerResult.value,
        query: query?.trim() || null,
        visibility: visibility ?? "all",
      };

      const { auths, warnings } = await resolveAuths({
        oauthToken: options.oauthToken,
        userId: options.userId,
        owner: filters.owner,
      });
      if (auths.length === 0) return unavailableError(warnings);

      const byFullName = new Map<string, GithubRepo>();
      for (const auth of auths) {
        const path =
          auth.source === "github_app_installation"
            ? "/installation/repositories?per_page=100"
            : "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member";
        const result = await fetchJson(path, auth);
        if (!result.ok) {
          warnings.push(result.warning);
          continue;
        }
        for (const repo of extractRepos(auth, result.body)) {
          if (repo.full_name && !byFullName.has(repo.full_name))
            byFullName.set(repo.full_name, repo);
        }
      }

      const repos = [...byFullName.values()]
        .filter((repo) => matchesFilters(repo, filters))
        .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
        .slice(0, limit ?? 30)
        .map(mapRepo);

      return {
        totalCount: repos.length,
        items: repos,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    },
  });
}
