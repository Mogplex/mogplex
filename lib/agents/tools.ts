import { tool } from "ai";
import { z } from "zod";
import {
  getUserConnections,
  getConnectionCredentials,
} from "@/lib/connections/service";
import { createRestApiTool } from "@/lib/connections/rest-tool";
import { cleanupMcpClients, getMcpTools } from "@/lib/connections/mcp-tools";
import { virtualExec } from "@/lib/virtual-shell";
import { isConnectionMisconfigured } from "@/lib/connections/validation";
import { logConnectionEvent } from "@/lib/connections/logging";
import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { createGithubIssue } from "@/lib/github-issues";
import { isRepoId } from "@/lib/repos";
import { assertSafeOutboundHttpUrlWithDns } from "@/lib/security/outbound-url";
import {
  ALL_CAPABILITIES,
  hasCapability,
  resolveMemberCapabilities as defaultResolveMemberCapabilities,
  type Capability,
} from "@/lib/team-capabilities";
import { deferTeamAuditEvent, recordTeamAuditEvent } from "@/lib/team-audit";
import { wrapToolsWithSlackIdempotency } from "@/lib/agents/slack-tool-idempotency";
import type { Tool } from "ai";
import type { Connection } from "@/lib/types";

/**
 * Capability tag per static tool key. Connection (REST / MCP) tools share
 * the `connections.create` cap in v1 (issue #559 spec); per-connection
 * capabilities are deferred.
 */
export const TOOL_CAPABILITY: Record<string, Capability> = {
  virtual_exec: "tools.virtual_exec",
  web_fetch: "tools.web_fetch",
  web_search: "tools.web_search",
  browse_skills: "tools.web_fetch",
  browse_vercel_docs: "tools.web_fetch",
  bash: "tools.bash",
  read_file: "tools.github_api",
  list_files: "tools.github_api",
  start_sandbox: "tools.bash",
  stop_sandbox: "tools.bash",
  github_api: "tools.github_api",
  // This is broader than the workspace-scoped github_api tool: it performs
  // authenticated org/user/repo PR inventory using the user's own GitHub auth.
  github_pr_search: "tools.github_api",
  github_create_issue: "tools.github_api",
  write_file: "tools.write_file",
  add_memory: "tools.memories",
  search_memories: "tools.memories",
  list_memories: "tools.memories",
};

const DYNAMIC_CONNECTION_CAPABILITY: Capability = "connections.create";

/**
 * Drop tool entries the caller's capability set doesn't cover. Unknown keys
 * fail closed — adding a new tool requires registering its capability in
 * `TOOL_CAPABILITY` (or `DYNAMIC_CONNECTION_CAPABILITY` for connection
 * tools, matched by prefix in `buildTools`).
 */
export function filterToolsByCapability<T extends Record<string, Tool>>(
  tools: T,
  caps: ReadonlySet<Capability>,
  resolveRequired: (key: string) => Capability | undefined = (k) =>
    TOOL_CAPABILITY[k],
  onDenied?: (toolName: string, requiredCapability: Capability | null) => void
): Partial<T> {
  if (caps.has("*")) return tools;
  const out: Record<string, Tool> = {};
  for (const [key, value] of Object.entries(tools)) {
    const required = resolveRequired(key);
    if (!required) {
      continue;
    }
    if (hasCapability(caps, required)) {
      out[key] = value;
    } else {
      onDenied?.(key, required);
    }
  }
  return out as Partial<T>;
}

const defineTool = (def: Record<string, unknown>): Tool =>
  tool(def as unknown as Tool);

type RepoToolDefaults = {
  owner?: string;
  repo?: string;
  branch?: string;
  rootDirectory?: string | null;
};

type SandboxResolutionStatus = "running" | "pending";
type SandboxResolutionSource =
  | "hint"
  | "reused_running"
  | "reused_pending"
  | "created";

type SandboxResolution = {
  sandboxId: string;
  status: SandboxResolutionStatus;
  source: SandboxResolutionSource;
};

/**
 * Base URL for self-directed API calls. Tools run server-side, so they need an
 * absolute origin: the explicit app URL when configured, the Vercel deployment
 * URL on preview/production, and localhost in development.
 */
function resolveAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  );
}

function encodeGitHubPath(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function resolveRepoTarget(
  input: { owner?: string; repo?: string; branch?: string },
  defaults?: RepoToolDefaults
) {
  const owner = input.owner || defaults?.owner;
  const repo = input.repo || defaults?.repo;
  const branch = input.branch || defaults?.branch || "main";

  if (!owner || !repo) {
    return {
      error:
        "Missing repository context. Re-run the request from an active workspace or specify owner and repo.",
    };
  }

  return { owner, repo, branch };
}

function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\da-z]+/g, "_")
    .replace(/^_|_$/g, "");
}

function getSandboxRequestHeaders(userId?: string) {
  try {
    return { headers: buildInternalApiHeaders(userId) };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Internal sandbox auth is not configured",
    };
  }
}

const webFetchParams = z
  .object({
    url: z.string().url().describe("The URL to fetch"),
  })
  .strict();

export const webFetch = defineTool({
  description: "Fetch content from a URL and return text",
  inputSchema: webFetchParams,
  execute: async ({ url }: z.infer<typeof webFetchParams>) => {
    const safeUrl = await assertSafeOutboundHttpUrlWithDns(url, "url");
    const res = await fetch(safeUrl, {
      headers: { "User-Agent": "MOGPLEX-Agent/1.0" },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const text = await res.text();
    return { content: text.slice(0, 8000), url: safeUrl, length: text.length };
  },
});

const webSearchParams = z.object({
  query: z.string().describe("Search query"),
  limit: z.number().default(5).describe("Max results"),
});

export const webSearch = defineTool({
  description: "Search the web using DuckDuckGo",
  inputSchema: webSearchParams,
  execute: async ({ query, limit }: z.infer<typeof webSearchParams>) => {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "MOGPLEX-Agent/1.0" },
    });
    const html = await res.text();
    const results: { title: string; url: string; snippet: string }[] = [];
    const regex =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\S\s]*?<a[^>]+class="result__snippet"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) && results.length < limit) {
      results.push({ url: match[1], title: match[2], snippet: match[3] });
    }
    return { results, query };
  },
});

const browseSkillsParams = z.object({
  query: z.string().optional().describe("Search query, omit for popular"),
});

export const browseSkills = defineTool({
  description: "Search skills.sh registry for agent skills",
  inputSchema: browseSkillsParams,
  execute: async ({ query }: z.infer<typeof browseSkillsParams>) => {
    const url = query
      ? `https://skills.sh/api/search?q=${encodeURIComponent(query)}`
      : `https://skills.sh/api/search?q=vercel`;
    const res = await fetch(url);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    return { skills: data.skills || data || [] };
  },
});

const browseVercelDocsParams = z.object({
  query: z.string().describe("Search query for Vercel documentation"),
});

export const browseVercelDocs = defineTool({
  description:
    "Search Vercel documentation for guides, best practices, and API references",
  inputSchema: browseVercelDocsParams,
  execute: async ({ query }: z.infer<typeof browseVercelDocsParams>) => {
    const baseUrl = resolveAppBaseUrl();
    const res = await fetch(
      `${baseUrl}/api/skills/vercel-docs?q=${encodeURIComponent(query)}`
    );
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const { docs } = await res.json();
    return {
      docs: (
        docs as {
          title: string;
          path: string;
          url: string;
          description: string;
        }[]
      ).slice(0, 10),
    };
  },
});

const terminalParams = z.object({
  command: z.string().describe("Shell command to run"),
  cwd: z.string().optional().describe("Working directory"),
});

/**
 * LLMs frequently pass the GitHub full_name ("owner/repo") instead of the
 * repos.id UUID. Resolve it here so downstream queries and the /api/sandbox
 * call always see a UUID.
 *
 * Returns `{ ok: false }` when the reference names a repo the user can't reach,
 * which is distinct from `{ ok: true, repoId: undefined }` (no repo requested).
 */
async function resolveRepoUuid(
  userId: string,
  repoId: string | undefined
): Promise<{ ok: true; repoId: string | undefined } | { ok: false }> {
  if (!repoId) return { ok: true, repoId: undefined };

  if (repoId.includes("/")) {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { data: lookup } = await supabaseAdmin
      .from("repos")
      .select("id")
      .eq("full_name", repoId)
      .eq("user_id", userId)
      .maybeSingle();
    return lookup?.id ? { ok: true, repoId: lookup.id } : { ok: false };
  }

  return isRepoId(repoId) ? { ok: true, repoId } : { ok: false };
}

/** Newest running sandbox for the user, optionally scoped to one repo. */
async function findRunningSandboxId(
  userId: string,
  repoId: string | undefined
): Promise<string | null> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const query = supabaseAdmin
    .from("sandboxes")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1);

  if (repoId) query.eq("repo_id", repoId);

  const { data } = await query.single();
  return data?.id ?? null;
}

/** A JSON response means the API handed back an already-existing sandbox. */
async function readReusedSandboxResponse(
  res: Response
): Promise<SandboxResolution | null> {
  if (!res.ok) return null;
  const { sandbox } = await res.json();
  if (!sandbox?.id) return null;

  const running = sandbox.runtime_summary?.status === "running";
  return {
    sandboxId: sandbox.id as string,
    status: running ? "running" : "pending",
    source: running ? "reused_running" : "reused_pending",
  };
}

/**
 * Classify one SSE line. `null` means "keep reading"; a settled result means
 * the caller should stop consuming the stream.
 */
function readSandboxCreationEvent(
  line: string
): { resolution: SandboxResolution | null } | null {
  if (!line.startsWith("data: ")) return null;

  let event: {
    type?: string;
    sandbox?: { id: string };
    recordId?: string;
  };
  try {
    event = JSON.parse(line.slice(6));
  } catch {
    return null;
  }

  if (event.type === "ready" && event.sandbox) {
    return {
      resolution: {
        sandboxId: event.sandbox.id,
        status: "running",
        source: "created",
      },
    };
  }

  // Settle once the record exists so the tool doesn't block on the full
  // bootstrap stream.
  if (event.type === "sandbox_created" && event.recordId) {
    return {
      resolution: {
        sandboxId: event.recordId,
        status: "pending",
        source: "created",
      },
    };
  }

  return event.type === "error" ? { resolution: null } : null;
}

/** SSE = new sandbox creation — consume until ready or error. */
async function consumeSandboxCreationStream(
  res: Response
): Promise<SandboxResolution | null> {
  if (!res.body) return null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return null;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const settled = readSandboxCreationEvent(line);
      if (!settled) continue;
      await reader.cancel().catch(() => {});
      return settled.resolution;
    }
  }
}

/**
 * Resolve the active sandbox ID for a user+repo at execution time.
 * If no sandbox is running and a repoId is provided, auto-creates one.
 */
async function resolveOrCreateSandbox(
  userId?: string,
  repoId?: string,
  hintSandboxId?: string
): Promise<SandboxResolution | null> {
  if (hintSandboxId) {
    return {
      sandboxId: hintSandboxId,
      status: "running",
      source: "hint",
    };
  }

  if (!userId) return null;

  const resolved = await resolveRepoUuid(userId, repoId);
  if (!resolved.ok) return null;
  const resolvedRepoId = resolved.repoId;

  const runningSandboxId = await findRunningSandboxId(userId, resolvedRepoId);
  if (runningSandboxId) {
    return {
      sandboxId: runningSandboxId,
      status: "running",
      source: "reused_running",
    };
  }

  // No running sandbox — auto-start if we have a resolved repoId
  if (!resolvedRepoId) return null;

  const requestHeaders = getSandboxRequestHeaders(userId);
  if ("error" in requestHeaders) return null;

  const res = await fetch(`${resolveAppBaseUrl()}/api/sandbox`, {
    method: "POST",
    headers: requestHeaders.headers,
    body: JSON.stringify({ repoId: resolvedRepoId }),
  });

  return (res.headers.get("Content-Type") || "").includes("application/json")
    ? readReusedSandboxResponse(res)
    : consumeSandboxCreationStream(res);
}

const EXEC_STDOUT_LIMIT = 10_000;
const EXEC_STDERR_LIMIT = 5000;

function postSandboxExec(
  sandboxId: string,
  headers: HeadersInit,
  body: { command: string; cwd?: string }
): Promise<Response> {
  return fetch(`${resolveAppBaseUrl()}/api/sandbox/${sandboxId}/exec`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** Shape an exec response, truncating streams so tool output stays bounded. */
function formatSandboxExecResult(
  data: { exitCode?: number; stdout?: string; stderr?: string },
  command: string
) {
  return {
    // `data` is an unvalidated `res.json()`. A malformed response should reach
    // the model as "we don't know" rather than as 0, which it would read as a
    // clean exit, so surface the gap instead of asserting it away.
    exitCode: data.exitCode ?? null,
    stdout: data.stdout?.slice(0, EXEC_STDOUT_LIMIT) ?? "",
    stderr: data.stderr?.slice(0, EXEC_STDERR_LIMIT) ?? "",
    command,
  };
}

/**
 * A 404/410 means the sandbox died between resolution and exec. Re-resolve once
 * and replay the command.
 *
 * Returns `null` when the failure wasn't a sandbox loss. Otherwise reports the
 * re-resolved id even if the replay failed, so the caller can drop its cached
 * (now dead) id rather than reusing it on the next call.
 */
async function retryExecAfterSandboxLoss(
  res: Response,
  ctx: {
    userId?: string;
    repoId?: string;
    headers: HeadersInit;
    command: string;
    cwd?: string;
  }
): Promise<{
  sandboxId: string | null;
  result: ReturnType<typeof formatSandboxExecResult> | null;
} | null> {
  if (res.status !== 404 && res.status !== 410) return null;

  const sandboxId =
    (await resolveOrCreateSandbox(ctx.userId, ctx.repoId))?.sandboxId ?? null;
  if (!sandboxId) return { sandboxId: null, result: null };

  const retry = await postSandboxExec(sandboxId, ctx.headers, {
    command: ctx.command,
    cwd: ctx.cwd,
  });

  return {
    sandboxId,
    result: retry.ok
      ? formatSandboxExecResult(await retry.json(), ctx.command)
      : null,
  };
}

export function createTerminalExec(
  sandboxId?: string,
  userId?: string,
  repoId?: string
) {
  // Track the resolved sandbox ID across calls within this tool instance
  let cachedSandboxId = sandboxId || null;

  return defineTool({
    description:
      "Execute a bash command. Use this for running shell commands, installing packages, running scripts, git operations, and any system tasks. A sandbox will be started automatically if needed.",
    inputSchema: terminalParams,
    execute: async ({ command, cwd }: z.infer<typeof terminalParams>) => {
      // Resolve sandbox at execution time (not build time)
      if (!cachedSandboxId) {
        cachedSandboxId =
          (await resolveOrCreateSandbox(userId, repoId, sandboxId))
            ?.sandboxId ?? null;
      }

      if (!cachedSandboxId) {
        return {
          error: "No sandbox available. Select a repository first.",
          command,
        };
      }

      const requestHeaders = getSandboxRequestHeaders(userId);
      if ("error" in requestHeaders) {
        return { error: requestHeaders.error, command };
      }

      const res = await postSandboxExec(
        cachedSandboxId,
        requestHeaders.headers,
        {
          command,
          cwd,
        }
      );
      if (res.ok) {
        return formatSandboxExecResult(await res.json(), command);
      }

      const retried = await retryExecAfterSandboxLoss(res, {
        userId,
        repoId,
        headers: requestHeaders.headers,
        command,
        cwd,
      });
      if (retried) {
        cachedSandboxId = retried.sandboxId;
        if (retried.result) return retried.result;
      }

      const data = await res.json().catch(() => ({}));
      return { error: (data.error as string) || "Failed", command };
    },
  });
}

export const terminalExec = createTerminalExec();

const readFileParams = z.object({
  path: z.string().describe("File path relative to repo root"),
  owner: z
    .string()
    .optional()
    .describe("GitHub owner. Optional when an active repository is selected."),
  repo: z
    .string()
    .optional()
    .describe(
      "GitHub repo name. Optional when an active repository is selected."
    ),
  branch: z
    .string()
    .optional()
    .describe("Branch name. Optional when an active repository is selected."),
});

export function createReadFile(
  githubToken?: string | null,
  repoDefaults?: RepoToolDefaults
) {
  return defineTool({
    description: "Read a file from the repository",
    inputSchema: readFileParams,
    execute: async ({
      path,
      owner,
      repo,
      branch,
    }: z.infer<typeof readFileParams>) => {
      let normalizedPath = path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
      if (!normalizedPath) {
        return {
          error:
            "Missing file path. Use list_files first to inspect directories, then read a specific file.",
        };
      }

      // Prepend rootDirectory so agents don't need to know the monorepo prefix
      if (
        repoDefaults?.rootDirectory &&
        !normalizedPath.startsWith(`${repoDefaults.rootDirectory}/`) &&
        normalizedPath !== repoDefaults.rootDirectory
      ) {
        normalizedPath = `${repoDefaults.rootDirectory}/${normalizedPath}`;
      }

      const target = resolveRepoTarget({ owner, repo, branch }, repoDefaults);
      if ("error" in target) return target;

      const url = `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${encodeGitHubPath(normalizedPath)}?ref=${target.branch}`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3.raw",
      };
      if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
      const res = await fetch(url, { headers });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const content = await res.text();
      return { path: normalizedPath, content: content.slice(0, 10000) };
    },
  });
}

const listFilesParams = z.object({
  path: z.string().default("").describe("Directory path"),
  owner: z
    .string()
    .optional()
    .describe("GitHub owner. Optional when an active repository is selected."),
  repo: z
    .string()
    .optional()
    .describe(
      "GitHub repo name. Optional when an active repository is selected."
    ),
  branch: z
    .string()
    .optional()
    .describe("Branch name. Optional when an active repository is selected."),
});

export function createListFiles(
  githubToken?: string | null,
  repoDefaults?: RepoToolDefaults
) {
  return defineTool({
    description: "List files in a repository directory",
    inputSchema: listFilesParams,
    execute: async ({
      path,
      owner,
      repo,
      branch,
    }: z.infer<typeof listFilesParams>) => {
      const target = resolveRepoTarget({ owner, repo, branch }, repoDefaults);
      if ("error" in target) return target;

      let normalizedPath = path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
      // Prepend rootDirectory so agents don't need to know the monorepo prefix
      if (
        repoDefaults?.rootDirectory &&
        !normalizedPath.startsWith(`${repoDefaults.rootDirectory}/`) &&
        normalizedPath !== repoDefaults.rootDirectory
      ) {
        normalizedPath = normalizedPath
          ? `${repoDefaults.rootDirectory}/${normalizedPath}`
          : repoDefaults.rootDirectory;
      }
      const contentsPath = normalizedPath
        ? `/${encodeGitHubPath(normalizedPath)}`
        : "";
      const url = `https://api.github.com/repos/${target.owner}/${target.repo}/contents${contentsPath}?ref=${target.branch}`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
      };
      if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
      const res = await fetch(url, { headers });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const items = await res.json();
      return {
        path: normalizedPath,
        files: (items as { name: string; type: string; size: number }[]).map(
          (i) => ({
            name: i.name,
            type: i.type,
            size: i.size,
          })
        ),
      };
    },
  });
}

const writeFileParams = z.object({
  path: z.string().describe("File path relative to sandbox root"),
  content: z.string().describe("File content to write"),
  sandboxId: z.string().describe("Sandbox record ID"),
});

export function createWriteFile(userId?: string) {
  return defineTool({
    description: "Write content to a file in the sandbox",
    inputSchema: writeFileParams,
    execute: async ({
      path,
      content,
      sandboxId,
    }: z.infer<typeof writeFileParams>) => {
      const baseUrl = resolveAppBaseUrl();

      const requestHeaders = getSandboxRequestHeaders(userId);
      if ("error" in requestHeaders) return { error: requestHeaders.error };

      const res = await fetch(`${baseUrl}/api/sandbox/${sandboxId}/files`, {
        method: "PUT",
        headers: requestHeaders.headers,
        body: JSON.stringify({ path, content }),
      });

      if (!res.ok) {
        const data = await res.json();
        return { error: (data.error as string) || "Write failed" };
      }

      return { ok: true, path };
    },
  });
}

const startSandboxParams = z.object({
  repoId: z
    .string()
    .describe(
      "The repo UUID (preferred) or GitHub full_name (e.g. 'owner/repo') to launch a sandbox for"
    ),
});

export function createStartSandbox(userId?: string) {
  return defineTool({
    description:
      "Launch a sandbox microVM for the current repository. This clones the repo, installs dependencies, and starts the dev server. Use this when the user asks to start a preview, run code, or you need a live environment.",
    inputSchema: startSandboxParams,
    execute: async ({ repoId }: z.infer<typeof startSandboxParams>) => {
      const requestHeaders = getSandboxRequestHeaders(userId);
      if ("error" in requestHeaders) return { error: requestHeaders.error };

      const sandbox = await resolveOrCreateSandbox(userId, repoId);
      if (!sandbox) {
        return { error: "Failed to start sandbox" };
      }

      const message =
        sandbox.source === "reused_running"
          ? "Sandbox is already running and ready to use."
          : sandbox.source === "reused_pending"
            ? "Sandbox startup is already in progress. The preview pane will update automatically when it's ready."
            : "Sandbox is launching. The preview pane will update automatically when it's ready.";

      return {
        ok: true,
        sandboxId: sandbox.sandboxId,
        status: sandbox.status,
        message,
      };
    },
  });
}

const stopSandboxParams = z.object({
  sandboxId: z.string().describe("The sandbox ID to stop"),
});

export function createStopSandbox(userId?: string) {
  return defineTool({
    description:
      "Stop a running sandbox microVM. Use this when the user asks to stop or shut down the preview.",
    inputSchema: stopSandboxParams,
    execute: async ({ sandboxId }: z.infer<typeof stopSandboxParams>) => {
      const baseUrl = resolveAppBaseUrl();

      const requestHeaders = getSandboxRequestHeaders(userId);
      if ("error" in requestHeaders) return { error: requestHeaders.error };

      const res = await fetch(`${baseUrl}/api/sandbox/${sandboxId}`, {
        method: "DELETE",
        headers: requestHeaders.headers,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { error: (data.error as string) || "Failed to stop sandbox" };
      }

      return { ok: true, message: "Sandbox stopped." };
    },
  });
}

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

const GITHUB_API_ORIGIN = "https://api.github.com";
// Keep small enough that a single tool result doesn't dominate the context
// window. Large listings paginate via the `link` header.
const GITHUB_API_MAX_BYTES = 64 * 1024;
const GITHUB_LOGIN_RE = /^[A-Za-z\d](?:[A-Za-z\d-]{0,37}[A-Za-z\d])?$/;
const GITHUB_REPO_NAME_RE = /^[A-Za-z\d._-]+$/;

const githubPrSearchParams = z
  .object({
    owner: z
      .string()
      .optional()
      .describe(
        "GitHub organization or user login to scope the search, e.g. 'webrenew'. Required when using GitHub App installation auth."
      ),
    ownerType: z
      .enum(["org", "user"])
      .default("org")
      .describe(
        "Whether owner is an organization or user. Use 'org' when the user says org."
      ),
    repo: z
      .string()
      .optional()
      .describe(
        "Optional repository name under owner. When provided, searches repo:owner/repo instead of all repos under owner."
      ),
    author: z
      .string()
      .optional()
      .describe("Optional GitHub username to filter PR author."),
    state: z
      .enum(["open", "closed", "all"])
      .default("open")
      .describe("Pull request state filter."),
    query: z
      .string()
      .optional()
      .describe(
        "Optional additional GitHub search terms or qualifiers. Do not include is:pr, state, author, org, user, repo, or is:draft qualifiers that are already represented by other inputs. Use draft:true or draft:false for draft filtering."
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Maximum PRs to return."),
  })
  .strict();

type GithubPrSearchOptions = {
  oauthToken?: string | null;
  userId?: string | null;
};

type GithubCreateIssueOptions = {
  userId?: string | null;
};

type GithubPrSearchAuth = {
  token: string;
  source: "oauth" | "github_app_installation";
  // Machine-readable auth label returned to the agent; user-facing visibility
  // copy lives in tool descriptions, warnings, and Slack prompt guidance.
  coverage: "oauth" | "app";
};

type GithubPrGraphqlPullRequest = {
  __typename?: string;
  repository?: { nameWithOwner?: string };
  number?: number;
  title?: string;
  state?: string;
  url?: string;
  author?: { login?: string } | null;
  isDraft?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type GithubPrGraphqlBody = {
  data?: {
    search?: {
      issueCount?: number;
      nodes?: Array<GithubPrGraphqlPullRequest | null>;
    };
    rateLimit?: {
      limit?: number;
      remaining?: number;
      resetAt?: string;
    };
  };
  errors?: Array<{
    message?: string;
    type?: string;
  }>;
  message?: string;
};

/** Absent input is valid and yields `{ value: null }`; malformed input errors. */
type NormalizedGithubIdentifier = { value: string | null } | { error: string };

function normalizeGithubLogin(
  value: string | undefined,
  label: string
): NormalizedGithubIdentifier {
  const trimmed = value?.trim();
  if (!trimmed) return { value: null };
  if (!GITHUB_LOGIN_RE.test(trimmed)) {
    return { error: `${label} must be a valid GitHub login.` };
  }
  return { value: trimmed };
}

function normalizeGithubRepoName(
  value: string | undefined
): NormalizedGithubIdentifier {
  const trimmed = value?.trim();
  if (!trimmed) return { value: null };
  if (!GITHUB_REPO_NAME_RE.test(trimmed)) {
    return { error: "repo must be a valid GitHub repository name." };
  }
  return { value: trimmed };
}

function isConflictingGithubPrSearchQualifier(term: string) {
  const normalized = term.startsWith("-") ? term.slice(1) : term;
  const separatorIndex = normalized.indexOf(":");
  if (separatorIndex === -1) return false;

  const qualifier = normalized.slice(0, separatorIndex).toLowerCase();
  const value = normalized.slice(separatorIndex + 1).toLowerCase();
  if (qualifier === "is") {
    // GitHub PR search uses draft:true/draft:false, not is:draft.
    return ["pr", "issue", "open", "closed", "draft"].includes(value);
  }
  if (qualifier === "type") return ["pr", "issue"].includes(value);
  return ["state", "author", "org", "user", "repo"].includes(qualifier);
}

function normalizeGithubSearchText(value: string | undefined) {
  const trimmed = value
    ?.trim()
    .split(/\s+/)
    .filter((term) => !isConflictingGithubPrSearchQualifier(term))
    .join(" ");
  return trimmed ? trimmed.slice(0, 300) : null;
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mogplex-agent",
  };
}

const GITHUB_PR_SEARCH_GRAPHQL_QUERY = `
query MogplexPullRequestSearch($query: String!, $first: Int!) {
  search(query: $query, type: ISSUE, first: $first) {
    issueCount
    nodes {
      __typename
      ... on PullRequest {
        repository {
          nameWithOwner
        }
        number
        title
        url
        author {
          login
        }
        state
        isDraft
        createdAt
        updatedAt
      }
    }
  }
  rateLimit {
    limit
    remaining
    resetAt
  }
}
`.trim();

async function findGithubInstallationTokenForOwner(input: {
  userId?: string | null;
  owner?: string | null;
}) {
  const { userId, owner } = input;
  if (!userId || !owner) return null;

  const [{ hasGithubAppConfig, createGithubInstallationAccessToken }, db] =
    await Promise.all([
      import("@/lib/github-app"),
      import("@/lib/supabase/admin"),
    ]);
  if (!hasGithubAppConfig()) return null;

  const { data, error } = await db.supabaseAdmin
    .from("github_installations")
    .select("installation_id, account_login")
    .eq("user_id", userId)
    .ilike("account_login", owner)
    .limit(1);
  if (error) {
    throw new Error(`Failed to load GitHub installations: ${error.message}`);
  }

  // Keep an exact local postcondition after the server-side Supabase filter so a
  // future query broadening cannot mint a token for the wrong account row.
  const installation = (
    (data ?? []) as Array<{
      installation_id?: number | null;
      account_login?: string | null;
    }>
  ).find(
    (row) =>
      row.installation_id &&
      row.account_login?.toLowerCase() === owner.toLowerCase()
  );
  if (!installation?.installation_id) return null;

  const { token } = await createGithubInstallationAccessToken(
    installation.installation_id
  );
  return token;
}

function authenticatedGithubPrSearchUnavailable(warnings: string[] = []) {
  return {
    error:
      "Authenticated GitHub PR search is unavailable. Connect GitHub OAuth or install the Mogplex GitHub App for the requested owner.",
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

async function resolveGithubPrSearchAuthCandidates(input: {
  oauthToken?: string | null;
  userId?: string | null;
  owner?: string | null;
}) {
  const auths: GithubPrSearchAuth[] = [];
  const warnings: string[] = [];

  if (input.owner) {
    try {
      const installationToken =
        await findGithubInstallationTokenForOwner(input);
      if (installationToken) {
        auths.push({
          token: installationToken,
          source: "github_app_installation",
          coverage: "app",
        });
      }
    } catch (error) {
      warnings.push(
        `GitHub App installation lookup failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }

  const oauthToken = input.oauthToken?.trim();
  if (oauthToken) {
    auths.push({
      token: oauthToken,
      source: "oauth",
      coverage: "oauth",
    });
  }

  if (auths.length === 0)
    return authenticatedGithubPrSearchUnavailable(warnings);
  return { auths, warnings };
}

function githubGraphqlErrorMessage(body: GithubPrGraphqlBody) {
  const graphQlError = body.errors?.find(
    (error) => typeof error.message === "string" && error.message.trim()
  );
  if (graphQlError?.message) return graphQlError.message;
  if (typeof body.message === "string" && body.message.trim()) {
    return body.message;
  }
  return "GitHub PR search failed";
}

function githubGraphqlRateLimited(body: GithubPrGraphqlBody) {
  return body.errors?.some((error) => error.type === "RATE_LIMITED") ?? false;
}

function githubGraphqlAuthFailed(body: GithubPrGraphqlBody) {
  return (
    body.errors?.some((error) => {
      const type = error.type?.toUpperCase();
      const message = error.message?.toLowerCase() ?? "";
      return (
        type === "FORBIDDEN" ||
        type === "UNAUTHORIZED" ||
        message.includes("resource not accessible by integration") ||
        message.includes("bad credentials") ||
        message.includes("requires authentication")
      );
    }) ?? false
  );
}

function shouldRetryGithubPrSearchWithNextAuth(input: {
  status: number;
  authFailed?: boolean;
  rateLimited?: boolean;
}) {
  return (
    input.status === 401 ||
    input.status === 403 ||
    input.status === 429 ||
    Boolean(input.authFailed) ||
    Boolean(input.rateLimited)
  );
}

function githubPrSearchRetryWarning(input: {
  source: GithubPrSearchAuth["source"];
  status: number;
  error?: string;
}) {
  const reason =
    input.status >= 400
      ? `status ${input.status}`
      : `GitHub GraphQL error: ${input.error ?? "unknown error"}`;
  return `${input.source} GitHub PR search failed with ${reason}; retried with the next available credential.`;
}

/** GitHub returns HTML/plain text on some failures, so tolerate non-JSON. */
function parseGithubPrGraphqlBody(raw: string): GithubPrGraphqlBody {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as GithubPrGraphqlBody;
  } catch {
    return { message: raw };
  }
}

function readGithubGraphqlRateLimit(body: GithubPrGraphqlBody) {
  const rateLimit = body.data?.rateLimit;
  return {
    limit: rateLimit?.limit ?? null,
    remaining: rateLimit?.remaining ?? null,
    reset: rateLimit?.resetAt ?? null,
  };
}

function normalizeGithubPrState(state: unknown) {
  return typeof state === "string" ? state.toLowerCase() : null;
}

/**
 * Surface a missing draft flag rather than defaulting it — callers otherwise
 * can't tell "not a draft" from "GitHub didn't say".
 */
function describeGithubPrDraftState(isDraft: unknown) {
  return typeof isDraft === "boolean"
    ? { draft: isDraft }
    : {
        warnings: [
          "Draft status was not returned by GitHub for this pull request.",
        ],
      };
}

function mapGithubPrSearchNode(node: GithubPrGraphqlPullRequest) {
  return {
    repo: node.repository?.nameWithOwner ?? null,
    number: node.number ?? null,
    title: node.title ?? null,
    url: node.url ?? null,
    author: node.author?.login ?? null,
    state: normalizeGithubPrState(node.state),
    ...describeGithubPrDraftState(node.isDraft),
    createdAt: node.createdAt ?? null,
    updatedAt: node.updatedAt ?? null,
  };
}

async function runGithubPrGraphqlSearch(input: {
  auth: GithubPrSearchAuth;
  searchQuery: string;
  limit: number;
}) {
  const searchRes = await fetch(`${GITHUB_API_ORIGIN}/graphql`, {
    method: "POST",
    headers: {
      ...githubHeaders(input.auth.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: GITHUB_PR_SEARCH_GRAPHQL_QUERY,
      variables: { query: input.searchQuery, first: input.limit },
    }),
    cache: "no-store",
  });
  const searchBody = parseGithubPrGraphqlBody(await searchRes.text());
  const rateLimit = readGithubGraphqlRateLimit(searchBody);
  const rateLimited = githubGraphqlRateLimited(searchBody);
  const authFailed = githubGraphqlAuthFailed(searchBody);

  if (!searchRes.ok || searchBody.errors?.length) {
    return {
      ok: false,
      status: searchRes.status,
      query: input.searchQuery,
      auth: { source: input.auth.source, coverage: input.auth.coverage },
      error: githubGraphqlErrorMessage(searchBody),
      rateLimit,
      authFailed,
      rateLimited,
    };
  }

  const nodes = searchBody.data?.search?.nodes ?? [];
  const items = nodes
    .filter(
      (node): node is GithubPrGraphqlPullRequest =>
        node?.__typename === "PullRequest"
    )
    .map(mapGithubPrSearchNode);

  return {
    ok: true,
    status: searchRes.status,
    query: input.searchQuery,
    auth: { source: input.auth.source, coverage: input.auth.coverage },
    totalCount:
      typeof searchBody.data?.search?.issueCount === "number"
        ? searchBody.data.search.issueCount
        : items.length,
    incompleteResults: false,
    items,
    rateLimit,
  };
}

/** Both a token and a workspace repo are required before any GitHub call. */
function resolveGithubApiContext(
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

/** Validate the caller-supplied identifiers before they reach the query. */
function normalizeGithubPrSearchInputs(input: {
  owner?: string;
  repo?: string;
  author?: string;
}):
  | { owner: string | null; repo: string | null; author: string | null }
  | { error: string } {
  const ownerResult = normalizeGithubLogin(input.owner, "owner");
  if ("error" in ownerResult) return { error: ownerResult.error };

  const repoResult = normalizeGithubRepoName(input.repo);
  if ("error" in repoResult) return { error: repoResult.error };

  const authorResult = normalizeGithubLogin(input.author, "author");
  if ("error" in authorResult) return { error: authorResult.error };

  if (repoResult.value && !ownerResult.value) {
    return { error: "owner is required when repo is provided." };
  }

  return {
    owner: ownerResult.value,
    repo: repoResult.value,
    author: authorResult.value,
  };
}

/** Assemble the GitHub search qualifiers from already-validated inputs. */
function buildGithubPrSearchQuery(input: {
  owner: string | null;
  repo: string | null;
  author: string | null;
  ownerType: string;
  state: string;
  query?: string;
}): string {
  const terms = ["is:pr"];

  if (input.state !== "all") terms.push(`is:${input.state}`);

  if (input.repo && input.owner) {
    terms.push(`repo:${input.owner}/${input.repo}`);
  } else if (input.owner) {
    terms.push(`${input.ownerType === "user" ? "user" : "org"}:${input.owner}`);
  }

  if (input.author) terms.push(`author:${input.author}`);

  const extraQuery = normalizeGithubSearchText(input.query);
  if (extraQuery) terms.push(extraQuery);

  terms.push("sort:updated-desc");
  return terms.join(" ");
}

/**
 * Try each auth candidate in turn, falling through to the next only when the
 * failure looks auth- or rate-related. Appends a warning per fallthrough so the
 * caller can explain why a weaker credential ended up serving the result.
 */
async function runGithubPrSearchWithFallback(
  auths: GithubPrSearchAuth[],
  searchQuery: string,
  limit: number,
  warnings: string[]
) {
  let result: Awaited<ReturnType<typeof runGithubPrGraphqlSearch>> | null =
    null;

  for (const [index, auth] of auths.entries()) {
    result = await runGithubPrGraphqlSearch({ auth, searchQuery, limit });

    const hasNextAuth = index < auths.length - 1;
    if (
      result.ok ||
      !hasNextAuth ||
      !shouldRetryGithubPrSearchWithNextAuth({
        status: result.status,
        authFailed: "authFailed" in result ? result.authFailed : undefined,
        rateLimited: "rateLimited" in result ? result.rateLimited : undefined,
      })
    ) {
      break;
    }

    warnings.push(
      githubPrSearchRetryWarning({
        source: result.auth.source,
        status: result.status,
        error: "error" in result ? result.error : undefined,
      })
    );
  }

  return result;
}

export function createGithubPrSearch(options: GithubPrSearchOptions = {}) {
  return defineTool({
    description:
      "Search GitHub pull requests visible to the connected GitHub account, including private repositories covered by the user's OAuth token or the Mogplex GitHub App installation for the requested owner. Read-only. Use this for org-wide, user-wide, repo-wide, or 'my PRs' questions. Do not use public web search for GitHub PR inventory when this tool is available.",
    inputSchema: githubPrSearchParams,
    execute: async ({
      owner,
      ownerType,
      repo,
      author,
      state,
      query,
      limit,
    }: z.infer<typeof githubPrSearchParams>) => {
      const normalized = normalizeGithubPrSearchInputs({ owner, repo, author });
      if ("error" in normalized) return { error: normalized.error };

      const authResolution = await resolveGithubPrSearchAuthCandidates({
        oauthToken: options.oauthToken,
        userId: options.userId,
        owner: normalized.owner,
      });
      if ("error" in authResolution) return authResolution;

      const searchQuery = buildGithubPrSearchQuery({
        ...normalized,
        ownerType: ownerType ?? "org",
        state: state ?? "open",
        query,
      });

      const warnings = [...authResolution.warnings];
      const result = await runGithubPrSearchWithFallback(
        authResolution.auths,
        searchQuery,
        limit ?? 10,
        warnings
      );

      if (!result) return authenticatedGithubPrSearchUnavailable(warnings);
      return warnings.length > 0 ? { ...result, warnings } : result;
    },
  });
}

const githubCreateIssueParams = z
  .object({
    owner: z
      .string()
      .describe("GitHub organization or user login, e.g. 'webrenew'."),
    repo: z.string().describe("Repository name under the owner, e.g. 'tools'."),
    title: z.string().trim().min(1).max(256).describe("Issue title."),
    body: z
      .string()
      .max(65_536)
      .default("")
      .describe("Issue body in GitHub Markdown."),
    labels: z
      .array(z.string().trim().min(1).max(50))
      .max(20)
      .default([])
      .describe("Existing repository labels to attach."),
  })
  .strict();

export function createGithubIssueTool(options: GithubCreateIssueOptions = {}) {
  return defineTool({
    description:
      "Create a GitHub issue in a repository covered by the current user's Mogplex GitHub App installation. Use only when the user explicitly asks to create/file/open an issue or confirms a previously proposed issue. Requires owner and repo; returns the created issue URL.",
    inputSchema: githubCreateIssueParams,
    execute: async ({
      owner,
      repo,
      title,
      body,
      labels,
    }: z.infer<typeof githubCreateIssueParams>) => {
      const normalized = normalizeGithubPrSearchInputs({ owner, repo });
      if ("error" in normalized) return { error: normalized.error };
      if (!normalized.owner || !normalized.repo) {
        return { error: "owner and repo are required." };
      }
      if (!options.userId) {
        return {
          error:
            "GitHub issue creation is unavailable because the current user is not authenticated.",
        };
      }

      let githubToken: string | null;
      try {
        githubToken = await findGithubInstallationTokenForOwner({
          userId: options.userId,
          owner: normalized.owner,
        });
      } catch (error) {
        return {
          error:
            error instanceof Error
              ? error.message
              : "GitHub App installation lookup failed.",
        };
      }
      if (!githubToken) {
        return {
          error: `GitHub issue creation is unavailable for ${normalized.owner}/${normalized.repo}. Install the Mogplex GitHub App for ${normalized.owner} and include this repository.`,
        };
      }

      try {
        const created = await createGithubIssue({
          githubToken,
          repoFullName: `${normalized.owner}/${normalized.repo}`,
          title,
          body,
          labels,
        });
        return {
          ok: true,
          repo: `${normalized.owner}/${normalized.repo}`,
          ...created,
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "GitHub issue creation failed.",
        };
      }
    },
  });
}

const virtualExecParams = z.object({
  command: z.string().describe("Bash command to run in the virtual shell"),
});

export const virtualExecTool = defineTool({
  description:
    "Run a command in an instant, in-memory virtual bash shell (~10ms). Supports ~100 Unix commands: grep, sed, awk, jq, sort, uniq, wc, head, tail, cut, tr, find, cat, echo, printf, date, base64, and more. The filesystem starts empty and has no network access. Use this for text processing and data analysis — pipe output from read_file through grep/sed/awk/jq. Use bash instead when you need real project files, git, package managers, or network access.",
  inputSchema: virtualExecParams,
  execute: async ({ command }: z.infer<typeof virtualExecParams>) => {
    try {
      return await virtualExec(command);
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "virtual_exec failed",
        command,
      };
    }
  },
});

export type MemoryToolContext = {
  workspaceSessionId?: string | null;
  conversationId?: string | null;
  sandboxId?: string | null;
};

const MEMORY_LANES = ["session", "semantic", "episodic", "procedural"] as const;

const MAX_MEMORY_METADATA_BYTES = 4096;

const addMemoryParams = z.object({
  lane: z
    .enum(MEMORY_LANES)
    .describe(
      "session=per-conversation log (append-only), semantic=stable facts about the user/project, episodic=specific past events, procedural=how-to patterns the user has accepted"
    ),
  content: z
    .string()
    .min(1)
    .max(16_000)
    .describe("The memory content to save. Keep concise and self-contained."),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .refine(
      (value) =>
        value === undefined ||
        JSON.stringify(value).length <= MAX_MEMORY_METADATA_BYTES,
      {
        message: `metadata must be under ${MAX_MEMORY_METADATA_BYTES} bytes when JSON-serialised`,
      }
    )
    .describe(
      `Optional small JSON object of tags (<${MAX_MEMORY_METADATA_BYTES}B when serialised).`
    ),
});

const searchMemoriesParams = z.object({
  query: z.string().min(1).describe("Natural-language search query"),
  lane: z
    .enum(MEMORY_LANES)
    .optional()
    .describe("Restrict to one lane; omit to search across all lanes"),
  limit: z.number().int().min(1).max(50).default(10),
});

const listMemoriesParams = z.object({
  lane: z.enum(MEMORY_LANES).describe("Which lane to list"),
  limit: z.number().int().min(1).max(100).default(20),
});

function summariseMemory(memory: {
  id: string;
  lane: string;
  content: string;
  created_at: string;
}) {
  return {
    id: memory.id,
    lane: memory.lane,
    created_at: memory.created_at,
    content:
      memory.content.length > 2000
        ? `${memory.content.slice(0, 2000)}…`
        : memory.content,
  };
}

/**
 * Memory tools mirror the widget's semantics: session lane is append-only
 * (read + write, never edit/forget — it's a log the agent and user both
 * append to), and all lanes are scoped to the signed-in user. Edit/forget
 * stay deliberately out of the agent surface; users prune from the widget.
 */
function createMemoryTools(
  userId: string,
  repoId: string | undefined,
  context: MemoryToolContext
): Record<string, Tool> {
  const baseScope = {
    repoId: repoId ?? null,
    workspaceSessionId: context.workspaceSessionId ?? null,
    conversationId: context.conversationId ?? null,
    sandboxId: context.sandboxId ?? null,
  };

  // Memoise the dynamic import + client. `import()` is already module-cached,
  // but `createMemoriesClient` allocates a fresh embedder closure per call and
  // the embedder caches the resolved gateway-key promise internally — so
  // reusing one client across all three tools in a conversation avoids paying
  // for `resolveGatewayKey` more than once per turn.
  let clientPromise: Promise<{
    mod: typeof import("@/lib/memories-client");
    client: ReturnType<
      typeof import("@/lib/memories-client").createMemoriesClient
    >;
  }> | null = null;
  const loadClient = () => {
    clientPromise ??= (async () => {
      const mod = await import("@/lib/memories-client");
      return { mod, client: mod.createMemoriesClient(userId) };
    })();
    return clientPromise;
  };

  const add_memory = defineTool({
    description:
      "Save a durable memory for this user. Session lane is append-only (no edit/delete). Use this to record user preferences, decisions, and session notes so future conversations have context.",
    inputSchema: addMemoryParams,
    execute: async ({
      lane,
      content,
      metadata,
    }: z.infer<typeof addMemoryParams>) => {
      try {
        const { mod, client } = await loadClient();
        const scopedMetadata = mod.buildLaneScopedMetadata(
          lane,
          metadata,
          baseScope
        );
        const memory = await mod.addToLane(
          client,
          lane,
          content,
          scopedMetadata
        );
        return {
          ok: true,
          memory: summariseMemory(memory),
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "add_memory failed",
        };
      }
    },
  });

  const search_memories = defineTool({
    description:
      "Search the user's saved memories across all lanes (or one lane). Returns up to `limit` matches ranked by semantic similarity, with a lexical fallback.",
    inputSchema: searchMemoriesParams,
    execute: async ({
      query,
      lane,
      limit,
    }: z.infer<typeof searchMemoriesParams>) => {
      try {
        const { mod, client } = await loadClient();
        // When no lane is supplied we're doing a cross-lane search. Passing
        // the full baseScope would narrow results to rows that were written
        // with `workspace_session_id` / `conversation_id` tags — which only
        // happens on session/episodic lanes. For cross-lane search we only
        // want to stay within the active repo, so restrict to repoId.
        const scope = lane
          ? mod.getMemoryScopeForLane(lane, baseScope)
          : baseScope.repoId
            ? { repoId: baseScope.repoId }
            : undefined;
        const results = await mod.searchMemories(
          client,
          query,
          lane,
          limit,
          scope
        );
        return {
          ok: true,
          count: results.length,
          memories: results.map(summariseMemory),
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : "search_memories failed",
        };
      }
    },
  });

  const list_memories = defineTool({
    description:
      "List the most recent memories in a lane (session/semantic/episodic/procedural), newest first. Use this to review what's already remembered before adding duplicates.",
    inputSchema: listMemoriesParams,
    execute: async ({ lane, limit }: z.infer<typeof listMemoriesParams>) => {
      try {
        const { mod, client } = await loadClient();
        const scope = mod.getMemoryScopeForLane(lane, baseScope);
        const results = await mod.listByLane(client, lane, limit, scope);
        return {
          ok: true,
          count: results.length,
          memories: results.map(summariseMemory),
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : "list_memories failed",
        };
      }
    },
  });

  return { add_memory, search_memories, list_memories };
}

export function buildStaticTools(
  sandboxId?: string,
  userId?: string,
  githubToken?: string | null,
  repoDefaults?: RepoToolDefaults,
  repoId?: string,
  memoryContext?: MemoryToolContext,
  /**
   * Capabilities granted to the active scope. Defaults to ALL_CAPABILITIES
   * so solo callers and existing tests are unaffected; team callers pass
   * the resolved preset (see `resolveMemberCapabilities`).
   */
  capabilities: ReadonlySet<Capability> = ALL_CAPABILITIES,
  onDenied?: (toolName: string, requiredCapability: Capability | null) => void,
  githubPrSearchOptions?: GithubPrSearchOptions
) {
  // Default to an empty memory context when not provided. Production calls
  // from buildTools() always pass an explicit context; direct callers
  // (ALL_TOOLS, tests) get the correct empty-scope behaviour so memories
  // aren't tagged with a stray sandbox_id that the widget doesn't filter on.
  const memoryTools = userId
    ? createMemoryTools(userId, repoId, memoryContext ?? {})
    : {};
  const all = {
    virtual_exec: virtualExecTool,
    web_fetch: webFetch,
    web_search: webSearch,
    browse_skills: browseSkills,
    browse_vercel_docs: browseVercelDocs,
    bash: createTerminalExec(sandboxId, userId, repoId),
    read_file: createReadFile(githubToken, repoDefaults),
    list_files: createListFiles(githubToken, repoDefaults),
    start_sandbox: createStartSandbox(userId),
    stop_sandbox: createStopSandbox(userId),
    ...memoryTools,
    ...(userId
      ? {
          github_pr_search: createGithubPrSearch({
            oauthToken: githubPrSearchOptions?.oauthToken ?? null,
            userId,
          }),
          github_create_issue: createGithubIssueTool({ userId }),
        }
      : {}),
    ...(githubToken
      ? { github_api: createGithubApi(githubToken, repoDefaults) }
      : {}),
    ...(sandboxId ? { write_file: createWriteFile(userId) } : {}),
  };
  return filterToolsByCapability(
    all,
    capabilities,
    (key) => TOOL_CAPABILITY[key],
    onDenied
  ) as typeof all;
}

/** GitHub OAuth token for the PR-search tool, which uses the user's own auth. */
async function resolveGithubPrSearchToken(
  userId: string | undefined,
  capabilities: ReadonlySet<Capability>
): Promise<string | null> {
  if (!userId || !hasCapability(capabilities, "tools.github_api")) return null;

  try {
    const { getOAuthToken } = await import("@/lib/oauth-tokens");
    return await getOAuthToken(userId, "github");
  } catch (err) {
    console.warn(
      "Failed to resolve GitHub OAuth token for PR search:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Resolve the GitHub token for private repo access AND the sandbox's
 * launch-time path. The latter is critical: agent tools like read_file /
 * list_files prepend the workspace prefix when reading from GitHub, and using
 * `repo.root_directory` instead of the running sandbox's path silently
 * corrupts the agent's view of its own environment when the user launched at
 * a different workspace (e.g. agent reads packages/api/README.md while the
 * sandbox runs in apps/admin).
 */
async function resolveRepoGithubContext(opts: {
  repoId?: string;
  userId?: string;
  sandboxId?: string;
}): Promise<{ githubToken: string | null; rootDirectory: string | null }> {
  const empty = { githubToken: null, rootDirectory: null };
  if (!opts.repoId || !opts.userId) return empty;

  try {
    const { getGithubAccessTokenForRepo } = await import("@/lib/github-access");
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { resolveSandboxRootDirectory } = await import("@/lib/repo-settings");

    // Issue the repo and (optional) sandbox lookups in parallel — they're
    // independent rows on the hot path of every agent tool invocation. The
    // sandbox query is also scoped to this repoId so a stale or mismatched
    // sandboxId can't resolve to a path from another repo.
    const repoQuery = supabaseAdmin
      .from("repos")
      .select("user_id, github_installation_id, root_directory")
      .eq("id", opts.repoId)
      .eq("user_id", opts.userId)
      .single();
    const sandboxQuery = opts.sandboxId
      ? supabaseAdmin
          .from("sandboxes")
          .select("root_directory")
          .eq("id", opts.sandboxId)
          .eq("user_id", opts.userId)
          .eq("repo_id", opts.repoId)
          .maybeSingle()
      : Promise.resolve({ data: null });

    const [{ data: repo }, { data: sandboxRow }] = await Promise.all([
      repoQuery,
      sandboxQuery,
    ]);

    if (!repo) return empty;

    const sandbox =
      sandboxRow && typeof sandboxRow === "object"
        ? (sandboxRow as { root_directory: string | null })
        : null;

    return {
      githubToken: await getGithubAccessTokenForRepo(repo),
      rootDirectory: resolveSandboxRootDirectory(
        sandbox,
        repo as { root_directory: string | null }
      ),
    };
  } catch (err) {
    console.warn(
      "Failed to resolve GitHub token for tools:",
      err instanceof Error ? err.message : err
    );
    return empty;
  }
}

type LoadedConnectionTools = { connName: string } & (
  | { connType: "rest_api"; tool: Tool }
  | {
      connType: "mcp_server";
      mcpTools: Awaited<ReturnType<typeof getMcpTools>>;
    }
);

/**
 * Resolve one connection's credential and materialize its tools. Throws so the
 * caller's `allSettled` can isolate a single bad connection from the rest.
 */
async function loadConnectionTools(
  conn: Connection,
  ctx: { userId?: string; repoId?: string },
  getValidAccessToken: (conn: Connection) => Promise<string>
): Promise<LoadedConnectionTools | null> {
  try {
    // OAuth gets a fresh access token, others use the stored credential.
    const cred = await (conn.auth_type === "oauth"
      ? getValidAccessToken(conn)
      : getConnectionCredentials(conn.id));

    if (conn.type === "rest_api") {
      return {
        connName: conn.name,
        connType: "rest_api",
        tool: createRestApiTool(conn, cred),
      };
    }

    if (conn.type === "mcp_server") {
      return {
        connName: conn.name,
        connType: "mcp_server",
        mcpTools: await getMcpTools(conn, cred || undefined),
      };
    }

    return null;
  } catch (error) {
    logConnectionEvent("connection_runtime_load_failed", {
      userId: ctx.userId,
      repoId: ctx.repoId,
      connectionId: conn.id,
      presetId: conn.source_preset,
      connectionType: conn.type,
      authType: conn.auth_type,
      reason: error instanceof Error ? error.message : String(error),
      surface: "chat",
    });
    throw error;
  }
}

/** Build the dynamic (REST / MCP) tool map, skipping misconfigured connections. */
async function buildDynamicConnectionTools(
  connections: Connection[],
  ctx: { userId?: string; repoId?: string }
): Promise<{
  dynamicTools: Record<string, Tool>;
  mcpCleanups: Array<() => Promise<void>>;
  mcpToolNames: Set<string>;
  restToolNames: Set<string>;
}> {
  const { getValidAccessToken } = await import("@/lib/connections/oauth");

  const runnable = connections.filter((conn) => {
    if (!isConnectionMisconfigured(conn)) return true;
    logConnectionEvent("connection_runtime_skipped", {
      userId: ctx.userId,
      repoId: ctx.repoId,
      connectionId: conn.id,
      presetId: conn.source_preset,
      connectionType: conn.type,
      authType: conn.auth_type,
      healthStatus: "misconfigured",
      reason: "misconfigured",
    });
    return false;
  });

  const results = await Promise.allSettled(
    runnable.map((conn) => loadConnectionTools(conn, ctx, getValidAccessToken))
  );

  const dynamicTools: Record<string, Tool> = {};
  const mcpCleanups: Array<() => Promise<void>> = [];
  const mcpToolNames = new Set<string>();
  const restToolNames = new Set<string>();

  for (const result of results) {
    if (result.status === "rejected" || !result.value) continue;
    const val = result.value;

    if (val.connType === "rest_api" && val.tool) {
      const toolName = `api_${sanitize(val.connName)}`;
      dynamicTools[toolName] = val.tool;
      restToolNames.add(toolName);
      continue;
    }

    if (val.connType === "mcp_server" && val.mcpTools) {
      mcpCleanups.push(val.mcpTools.cleanup);
      for (const [name, t] of Object.entries(val.mcpTools.tools)) {
        const toolName = `${sanitize(val.connName)}_${name}`;
        dynamicTools[toolName] = t;
        mcpToolNames.add(toolName);
      }
    }
  }

  return { dynamicTools, mcpCleanups, mcpToolNames, restToolNames };
}

/**
 * Resolve scope capabilities once so both static and dynamic tool filtering see
 * the same set. Solo scope (no teamId, no override) → all capabilities.
 */
async function resolveScopeCapabilities(opts: {
  capabilities?: ReadonlySet<Capability>;
  teamId?: string | null;
  userId?: string;
}): Promise<ReadonlySet<Capability>> {
  if (opts.capabilities) return opts.capabilities;
  if (opts.teamId && opts.userId) {
    return await defaultResolveMemberCapabilities(opts.userId, opts.teamId);
  }
  return ALL_CAPABILITIES;
}

/**
 * Connection (REST / MCP) tools share `connections.create` in v1. If the role
 * lacks it, the caller skips the connection lookups entirely — no value in
 * resolving credentials we won't expose. Records the denial as a side effect so
 * the audit trail matches what the caller actually withheld.
 */
function canUseConnectionTools(
  capabilities: ReadonlySet<Capability>,
  teamId: string | null | undefined,
  deniedTools: Array<{
    toolName: string;
    requiredCapability: Capability | null;
  }>
): boolean {
  if (hasCapability(capabilities, DYNAMIC_CONNECTION_CAPABILITY)) return true;
  if (teamId) {
    deniedTools.push({
      toolName: "connections",
      requiredCapability: DYNAMIC_CONNECTION_CAPABILITY,
    });
  }
  return false;
}

/** Connections visible to this scope; a repoId narrows them to that repo. */
async function loadScopedConnections(
  userId: string,
  repoId: string | undefined
): Promise<Connection[]> {
  const { getResolvedConnections } = await import("@/lib/connections/service");
  const load = repoId
    ? getResolvedConnections(userId, repoId)
    : getUserConnections(userId);
  return await load.catch(() => [] as Connection[]);
}

export async function buildTools(opts: {
  sandboxId?: string;
  userId?: string;
  repoId?: string;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  workspaceSessionId?: string | null;
  conversationId?: string | null;
  /** Team scope, if the caller is acting inside a team. Null = solo. */
  teamId?: string | null;
  /**
   * Pre-resolved capability set. When omitted and `teamId` is set,
   * `resolveMemberCapabilities` is invoked.
   */
  capabilities?: ReadonlySet<Capability>;
  /**
   * Stable external event identity. When set, mutating tool executions are
   * durably deduplicated within this scope.
   */
  toolExecutionIdempotencyKey?: string | null;
}): Promise<{
  tools: Record<string, Tool>;
  connections: Connection[];
  cleanup: () => Promise<void>;
}> {
  const capabilities = await resolveScopeCapabilities(opts);
  const deniedTools: Array<{
    toolName: string;
    requiredCapability: Capability | null;
  }> = [];
  // Sequential on purpose. Both lookups can bottom out in
  // getOAuthToken(userId, "github"), which migrates a legacy
  // profiles.github_token into the vault and then clears the column. Run
  // concurrently, the second reader can load the legacy row after the first
  // has cleared it and get null back for a token that does exist.
  const githubPrSearchOAuthToken = await resolveGithubPrSearchToken(
    opts.userId,
    capabilities
  );
  const { githubToken, rootDirectory } = await resolveRepoGithubContext(opts);

  const staticTools = buildStaticTools(
    opts.sandboxId,
    opts.userId,
    githubToken,
    {
      owner: opts.repoOwner,
      repo: opts.repoName,
      branch: opts.repoBranch,
      rootDirectory,
    },
    opts.repoId,
    {
      workspaceSessionId: opts.workspaceSessionId ?? null,
      conversationId: opts.conversationId ?? null,
      sandboxId: opts.sandboxId ?? null,
    },
    capabilities,
    opts.teamId
      ? (toolName, requiredCapability) => {
          deniedTools.push({ toolName, requiredCapability });
        }
      : undefined,
    {
      oauthToken: githubPrSearchOAuthToken,
      userId: opts.userId,
    }
  );

  const emptyCleanup = async () => undefined;
  const emptyDynamicToolNames = {
    mcp: new Set<string>(),
    rest: new Set<string>(),
  };
  const withIdempotency = (
    tools: Record<string, Tool>,
    dynamicToolNames: {
      mcp: ReadonlySet<string>;
      rest: ReadonlySet<string>;
    } = emptyDynamicToolNames
  ) =>
    opts.userId && opts.toolExecutionIdempotencyKey
      ? wrapToolsWithSlackIdempotency(tools, {
          scopeKey: opts.toolExecutionIdempotencyKey,
          userId: opts.userId,
          mcpToolNames: dynamicToolNames.mcp,
          restToolNames: dynamicToolNames.rest,
        })
      : tools;

  if (!opts.userId) {
    return {
      tools: withIdempotency(staticTools),
      connections: [],
      cleanup: emptyCleanup,
    };
  }

  if (!canUseConnectionTools(capabilities, opts.teamId, deniedTools)) {
    recordDeniedTools(opts.teamId, opts.userId, deniedTools);
    return {
      tools: withIdempotency(staticTools),
      connections: [],
      cleanup: emptyCleanup,
    };
  }

  const connections = await loadScopedConnections(opts.userId, opts.repoId);
  if (connections.length === 0) {
    recordDeniedTools(opts.teamId ?? null, opts.userId, deniedTools);
    return {
      tools: withIdempotency(staticTools),
      connections: [],
      cleanup: emptyCleanup,
    };
  }

  const { dynamicTools, mcpCleanups, mcpToolNames, restToolNames } =
    await buildDynamicConnectionTools(connections, {
      userId: opts.userId,
      repoId: opts.repoId,
    });

  recordDeniedTools(opts.teamId ?? null, opts.userId, deniedTools);
  return {
    tools: withIdempotency(
      { ...staticTools, ...dynamicTools },
      { mcp: mcpToolNames, rest: restToolNames }
    ),
    connections,
    cleanup: () => cleanupMcpClients(mcpCleanups),
  };
}

function recordDeniedTools(
  teamId: string | null | undefined,
  userId: string | undefined,
  deniedTools: Array<{
    toolName: string;
    requiredCapability: Capability | null;
  }>
) {
  if (!teamId || !userId || deniedTools.length === 0) return;
  deferTeamAuditEvent(recordTeamAuditEvent, {
    productTeamId: teamId,
    actorUserId: userId,
    action: "tool.denied",
    decisionCode: "capability_denied",
    targetType: "tool_set",
    payload: {
      denied_tools: deniedTools.map((tool) => ({
        name: tool.toolName,
        required_capability: tool.requiredCapability,
      })),
    },
  });
}

/** @deprecated Use buildTools() for async version with connection support */
export const ALL_TOOLS = buildStaticTools();
