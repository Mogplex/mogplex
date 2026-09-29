import { describe, expect, it, vi } from "vitest";
import type { Tool } from "ai";
import { withoutHarnessRunConnections } from "@/lib/agents/tools/connections";
import type { Connection } from "@/lib/types";
import {
  buildHarnessMogplexTools,
  harnessToolRunFromCall,
} from "./mogplex-tools";

const tool = { description: "t", inputSchema: {} } as unknown as Tool;
const run = {
  userId: "user-1",
  aiCallId: "call-1",
  sandboxRecordId: "sandbox-1",
  repoId: "repo-1",
  teamId: "team-1",
  conversationId: "conv-1",
};

describe("buildHarnessMogplexTools", () => {
  it("should serve the native tools except the ones the harness runs itself", async () => {
    const buildTools = vi.fn(async () => ({
      tools: {
        bash: tool,
        virtual_exec: tool,
        read_file: tool,
        list_files: tool,
        write_file: tool,
        edit_file: tool,
        start_sandbox: tool,
        stop_sandbox: tool,
        github_merge_pull_request: tool,
        web_search: tool,
        add_memory: tool,
        find_skills: tool,
        github_create_issue: tool,
        api_stripe: tool,
        trigger_list_runs: tool,
      },
      connections: [],
      cleanup: async () => undefined,
    }));
    const capabilities = new Set(["tools.web_search"] as const);

    const { tools } = await buildHarnessMogplexTools(run, capabilities, {
      buildTools: buildTools as never,
      loadSandboxRepo: async () => ({
        working_branch: "mogplex/agent-1",
        base_branch: "main",
        repo: { full_name: "acme/web" },
      }),
    });

    expect(Object.keys(tools).sort()).toEqual([
      "add_memory",
      "api_stripe",
      "find_skills",
      "github_create_issue",
      "trigger_list_runs",
      "web_search",
    ]);
    expect(buildTools).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        repoId: "repo-1",
        sandboxId: "sandbox-1",
        repoOwner: "acme",
        repoName: "web",
        repoBranch: "mogplex/agent-1",
        repoBaseBranch: "main",
        teamId: "team-1",
        conversationId: "conv-1",
        capabilities,
        skipMcpServerConnections: true,
      })
    );
  });

  it("should read the run scope from the harness ai_call", () => {
    expect(
      harnessToolRunFromCall(
        {
          purpose: "harness-web-research",
          userId: "user-1",
          aiCallId: "call-1",
          sandboxRecordId: "sandbox-1",
          expiresAt: 0,
        },
        {
          repo_id: "repo-1",
          conversation_id: null,
          metadata: { product_team_id: "team-1" },
        }
      )
    ).toEqual({ ...run, conversationId: null });
  });
});

describe("withoutHarnessRunConnections", () => {
  const conn = (overrides: Partial<Connection>) =>
    ({ id: overrides.name, type: "mcp_server", ...overrides }) as Connection;

  it("should keep only connections a harness cannot run from its mcp.json", () => {
    const kept = withoutHarnessRunConnections([
      conn({ name: "linear" }),
      conn({ name: "stripe", type: "rest_api" }),
      conn({ name: "trigger", source_preset: "trigger" }),
    ]);

    expect(kept.map((c) => c.name)).toEqual(["stripe", "trigger"]);
  });
});
