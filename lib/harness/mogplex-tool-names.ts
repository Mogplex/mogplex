/**
 * Native tools a harness is not served: ones its CLI already has in its own
 * form (shell, files) or that cannot work for it. Everything else the native
 * Mogplex agent gets is served to the harness over the run's MCP server.
 */
export const HARNESS_LOCAL_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "virtual_exec",
  "read_file",
  "list_files",
  "write_file",
  "edit_file",
  // It would stop or replace the sandbox the harness is running in.
  "start_sandbox",
  "stop_sandbox",
  // Its consent check reads the user's own message in a chat turn, which a
  // harness request does not carry, so every call would be refused.
  "github_merge_pull_request",
]);

/** Mogplex tools that only read; the MCP server marks them read-only. */
export const MOGPLEX_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "web_search",
  "web_fetch",
  "browse_skills",
  "browse_vercel_docs",
  "search_memories",
  "list_memories",
  "find_skills",
  "load_skill",
  "github_pr_search",
  "github_list_repos",
  "github_pull_request_status",
]);
