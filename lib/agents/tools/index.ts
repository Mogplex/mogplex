import type { Tool } from "ai";
import {
  ALL_CAPABILITIES,
  hasCapability,
  resolveMemberCapabilities as defaultResolveMemberCapabilities,
  type Capability,
} from "@/lib/team-capabilities";
import { deferTeamAuditEvent, recordTeamAuditEvent } from "@/lib/team-audit";
import { wrapToolsWithSlackIdempotency } from "@/lib/agents/slack-tool-idempotency";
import type { Connection } from "@/lib/types";
import { webFetch, webSearch, browseSkills, browseVercelDocs } from "./web";
import {
  createTerminalExec,
  createWriteFile,
  createStartSandbox,
  createStopSandbox,
} from "./sandbox";
import { createReadFile, createListFiles } from "./github-files";
import { createGithubApi, createGithubPullRequestTool } from "./github-api";
import {
  createGithubPrSearch,
  type GithubPrSearchOptions,
} from "./github-pr-search";
import { createGithubRepoList } from "./github-repo-list";
import { createGithubIssueTool } from "./github-issue";
import { createMemoryTools, type MemoryToolContext } from "./memory";
import { virtualExecTool } from "./virtual-exec";
import {
  buildDynamicConnectionTools,
  canUseConnectionTools,
  loadScopedConnections,
  cleanupMcpClients,
} from "./connections";
import type { RepoToolDefaults } from "./shared";

// Re-export from submodules
export { webFetch, webSearch, browseSkills, browseVercelDocs } from "./web";
export {
  createTerminalExec,
  terminalExec,
  createWriteFile,
  createStartSandbox,
  createStopSandbox,
} from "./sandbox";
export { createReadFile, createListFiles } from "./github-files";
export { createGithubApi, createGithubPullRequestTool } from "./github-api";
export {
  createGithubPrSearch,
  type GithubPrSearchOptions,
} from "./github-pr-search";
export { createGithubRepoList } from "./github-repo-list";
export { createGithubIssueTool } from "./github-issue";
export { createMemoryTools, type MemoryToolContext } from "./memory";
export { virtualExecTool } from "./virtual-exec";
export {
  buildDynamicConnectionTools,
  canUseConnectionTools,
  loadScopedConnections,
  cleanupMcpClients,
  DYNAMIC_CONNECTION_CAPABILITY,
} from "./connections";
export type { RepoToolDefaults } from "./shared";

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
  // Same authenticated-inventory class as github_pr_search: lists repos
  // (including private) visible to the user's installations/OAuth.
  github_list_repos: "tools.github_api",
  github_create_issue: "tools.github_api",
  github_create_pull_request: "tools.github_api",
  write_file: "tools.write_file",
  add_memory: "tools.memories",
  search_memories: "tools.memories",
  list_memories: "tools.memories",
};

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
          github_list_repos: createGithubRepoList({
            oauthToken: githubPrSearchOptions?.oauthToken ?? null,
            userId,
          }),
          github_create_issue: createGithubIssueTool({ userId }),
        }
      : {}),
    ...(githubToken
      ? {
          github_api: createGithubApi(githubToken, repoDefaults),
          github_create_pull_request: createGithubPullRequestTool(
            githubToken,
            repoDefaults
          ),
        }
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

export async function buildTools(opts: {
  sandboxId?: string;
  userId?: string;
  repoId?: string;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  repoBaseBranch?: string;
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
      baseBranch: opts.repoBaseBranch,
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

/** @deprecated Use buildTools() for async version with connection support */
export const ALL_TOOLS = buildStaticTools();
