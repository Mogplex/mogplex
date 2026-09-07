import type { Tool } from "ai";
import { hasCapability, type Capability } from "@/lib/team-capabilities";

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
  github_pull_request_status: "tools.github_api",
  // Same authenticated-inventory class as github_pr_search: lists repos
  // (including private) visible to the user's installations/OAuth.
  github_list_repos: "tools.github_api",
  github_create_issue: "tools.github_api",
  github_update_issue: "tools.github_api",
  github_comment_issue: "tools.github_api",
  github_merge_pull_request: "tools.github_api",
  github_create_pull_request: "tools.github_api",
  github_update_pull_request: "tools.github_api",
  write_file: "tools.write_file",
  edit_file: "tools.write_file",
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
