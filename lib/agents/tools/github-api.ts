import { z } from "zod";
import { defineTool, type RepoToolDefaults } from "./shared";

const GITHUB_API_ORIGIN = "https://api.github.com";
// Keep small enough that a single tool result doesn't dominate the context
// window. Large listings paginate via the `link` header.
const GITHUB_API_MAX_BYTES = 64 * 1024;

const githubApiParams = z.object({
  path: z
    .string()
    .describe(
      "GitHub REST API path scoped to the current workspace repo, e.g. '/repos/{owner}/{repo}/pulls?state=open'. The '{owner}' and '{repo}' placeholders are substituted server-side; access outside the workspace repo is rejected."
    ),
  method: z
    .enum(["GET", "HEAD"])
    .default("GET")
    .describe("HTTP method. Only read methods are supported via this tool."),
  accept: z
    .string()
    .optional()
    .describe(
      "Optional Accept header override, e.g. 'application/vnd.github.raw' for raw file content."
    ),
});

/** Both a token and a workspace repo are required before any GitHub call. */
export function resolveGithubApiContext(
  githubToken: string | null | undefined,
  repoDefaults: RepoToolDefaults | undefined
): { owner: string; repo: string } | { error: string } {
  if (!githubToken) {
    return {
      error:
        "GitHub access is not configured for this workspace. Connect the Mogplex GitHub App in Settings to enable GitHub queries.",
    };
  }

  const { owner, repo } = repoDefaults ?? {};
  if (!owner || !repo) {
    return {
      error:
        "Missing workspace repo context. This tool is restricted to the current workspace repo; open a workspace first.",
    };
  }

  return { owner, repo };
}

/**
 * Resolve and scope a GitHub API path. Enforcing the workspace-repo prefix here
 * is load-bearing: the installation token may be broader than this workspace
 * repo (e.g. org installs), so the agent must never reach outside
 * `/repos/{owner}/{repo}/*`.
 */
function resolveGithubApiUrl(
  path: string,
  owner: string,
  repo: string
): { url: string } | { error: string } {
  if (!path.startsWith("/")) {
    return { error: "path must start with '/'" };
  }

  const resolvedPath = path
    .replaceAll("{owner}", encodeURIComponent(owner))
    .replaceAll("{repo}", encodeURIComponent(repo));

  if (resolvedPath.startsWith("//") || /\s/.test(resolvedPath)) {
    return { error: "Invalid characters in GitHub API path" };
  }

  let parsed: URL;
  try {
    parsed = new URL(resolvedPath, GITHUB_API_ORIGIN);
  } catch {
    return { error: "Invalid GitHub API path" };
  }

  if (parsed.origin !== GITHUB_API_ORIGIN) {
    return { error: "Path must resolve to api.github.com" };
  }

  const expectedPrefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (
    pathname !== expectedPrefix &&
    !pathname.startsWith(`${expectedPrefix}/`)
  ) {
    return {
      error: `Path must target the current workspace repo (${owner}/${repo}). Use '/repos/{owner}/{repo}/...'.`,
    };
  }

  return { url: parsed.toString() };
}

/**
 * Read a response body, stopping once it exceeds the tool's byte budget.
 * Returns null when the response has no readable body.
 */
async function readBoundedGithubBody(
  res: Response
): Promise<{ raw: string; truncated: boolean } | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;

  let received = 0;
  let truncated = false;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > GITHUB_API_MAX_BYTES) {
      truncated = true;
      break;
    }
    chunks.push(value);
  }

  if (truncated) {
    try {
      await reader.cancel();
    } catch {
      // ignore cancel failure
    }
  }

  return {
    raw: new TextDecoder().decode(
      chunks.length === 1 ? chunks[0] : Buffer.concat(chunks.map(Buffer.from))
    ),
    truncated,
  };
}

/** JSON-decode only when the response claims JSON and wasn't cut short. */
function parseGithubApiBody(
  raw: string,
  contentType: string,
  truncated: boolean
): unknown {
  if (truncated || !contentType.includes("application/json") || !raw) {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function createGithubApi(
  githubToken?: string | null,
  repoDefaults?: RepoToolDefaults
) {
  return defineTool({
    description:
      "Query the GitHub REST API for the current workspace repo (authenticated via the Mogplex GitHub App). Read-only (GET/HEAD). Paths are restricted to '/repos/{owner}/{repo}/*' for the current workspace repo — requests to other repos, /user/*, /orgs/*, or unrelated endpoints are rejected. Use this for issues, pull requests, checks, commits, comments, reviews, and releases. Large responses are truncated at 64 KB; paginate via the returned `link` header.",
    inputSchema: githubApiParams,
    execute: async ({
      path,
      method,
      accept,
    }: z.infer<typeof githubApiParams>) => {
      const context = resolveGithubApiContext(githubToken, repoDefaults);
      if ("error" in context) return { error: context.error };

      const resolved = resolveGithubApiUrl(path, context.owner, context.repo);
      if ("error" in resolved) return { error: resolved.error };

      const headers: Record<string, string> = {
        Accept: accept ?? "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mogplex-agent",
      };

      let res: Response;
      try {
        res = await fetch(resolved.url, { method, headers });
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : "GitHub request failed",
        };
      }

      const rateLimit = {
        limit: res.headers.get("x-ratelimit-limit"),
        remaining: res.headers.get("x-ratelimit-remaining"),
        reset: res.headers.get("x-ratelimit-reset"),
      };
      const link = res.headers.get("link");

      if (method === "HEAD") {
        return { ok: res.ok, status: res.status, link, rateLimit };
      }

      const read = await readBoundedGithubBody(res);
      if (!read) {
        return { ok: res.ok, status: res.status, body: null, link, rateLimit };
      }

      const { raw, truncated } = read;
      const body = parseGithubApiBody(
        raw,
        res.headers.get("content-type") ?? "",
        truncated
      );

      return {
        ok: res.ok,
        status: res.status,
        body,
        link,
        rateLimit,
        ...(truncated
          ? {
              truncated: true,
              note: `Response exceeded ${GITHUB_API_MAX_BYTES} bytes and was truncated.`,
            }
          : {}),
      };
    },
  });
}

const githubCreatePullRequestParams = z
  .object({
    title: z.string().trim().min(1).max(256),
    body: z.string().max(20_000).default(""),
    head: z.string().trim().min(1).max(255).optional(),
    base: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

export function createGithubPullRequestTool(
  githubToken?: string | null,
  repoDefaults?: RepoToolDefaults
) {
  return defineTool({
    description:
      "Open a pull request for the current workspace repository after committing and pushing the sandbox branch. Returns an existing open pull request for the same head and base instead of creating a duplicate.",
    inputSchema: githubCreatePullRequestParams,
    execute: async ({
      title,
      body,
      head,
      base,
    }: z.infer<typeof githubCreatePullRequestParams>) => {
      const context = resolveGithubApiContext(githubToken, repoDefaults);
      if ("error" in context) return { error: context.error };

      const resolvedHead = head ?? repoDefaults?.branch;
      const resolvedBase = base ?? repoDefaults?.baseBranch ?? "main";
      if (!resolvedHead) {
        return { error: "Missing sandbox branch for pull request delivery." };
      }
      if (resolvedHead === resolvedBase) {
        return {
          error:
            "Pull requests require a working branch different from the base branch.",
        };
      }

      const headers = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mogplex-agent",
      };
      const listUrl = new URL(
        `/repos/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}/pulls`,
        GITHUB_API_ORIGIN
      );
      listUrl.searchParams.set("state", "open");
      listUrl.searchParams.set("head", `${context.owner}:${resolvedHead}`);
      listUrl.searchParams.set("base", resolvedBase);
      const existingResponse = await fetch(listUrl, { headers });
      if (!existingResponse.ok) {
        return {
          error: `GitHub could not check existing pull requests (${existingResponse.status}).`,
        };
      }
      const existing = (await existingResponse.json()) as Array<{
        number?: number;
        html_url?: string;
      }>;
      if (existing[0]?.html_url) {
        return {
          ok: true,
          created: false,
          pullRequestNumber: existing[0].number ?? null,
          pullRequestUrl: existing[0].html_url,
        };
      }

      const createResponse = await fetch(listUrl.origin + listUrl.pathname, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title,
          body,
          head: resolvedHead,
          base: resolvedBase,
        }),
      });
      const created = (await createResponse.json().catch(() => ({}))) as {
        number?: number;
        html_url?: string;
        message?: string;
      };
      if (!createResponse.ok || !created.html_url) {
        return {
          error:
            created.message ||
            `GitHub could not create the pull request (${createResponse.status}).`,
        };
      }

      return {
        ok: true,
        created: true,
        pullRequestNumber: created.number ?? null,
        pullRequestUrl: created.html_url,
      };
    },
  });
}
