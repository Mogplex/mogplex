/**
 * Agent tool definitions.
 *
 * This file re-exports from lib/agents/tools/ for backwards compatibility.
 * New code should import directly from "@/lib/agents/tools".
 */

// Re-export all public API from the tools module
export {
  // Constants
  TOOL_CAPABILITY,
  DYNAMIC_CONNECTION_CAPABILITY,
  // Functions
  filterToolsByCapability,
  buildStaticTools,
  buildTools,
  // Web tools
  webFetch,
  webSearch,
  browseSkills,
  browseVercelDocs,
  // Sandbox tools
  createTerminalExec,
  terminalExec,
  createWriteFile,
  createStartSandbox,
  createStopSandbox,
  // GitHub tools
  createReadFile,
  createListFiles,
  createGithubApi,
  createGithubPullRequestTool,
  createGithubPrSearch,
  createGithubIssueTool,
  // Memory tools
  createMemoryTools,
  // Virtual exec
  virtualExecTool,
  // Connections
  buildDynamicConnectionTools,
  canUseConnectionTools,
  loadScopedConnections,
  cleanupMcpClients,
  // Deprecated
  ALL_TOOLS,
} from "./tools/index";

// Re-export types
export type {
  MemoryToolContext,
  RepoToolDefaults,
  GithubPrSearchOptions,
} from "./tools/index";
