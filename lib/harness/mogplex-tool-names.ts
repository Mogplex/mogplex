/**
 * Native tools a harness CLI already has in its own form (shell, files) or
 * must not hold (stopping the sandbox it runs in). Everything else the native
 * Mogplex agent gets is served to the harness over the run's MCP server.
 */
export const HARNESS_LOCAL_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "virtual_exec",
  "read_file",
  "list_files",
  "write_file",
  "edit_file",
  "start_sandbox",
  "stop_sandbox",
]);

/** Mogplex tools that only read. SAFE runs may call these and nothing else. */
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
