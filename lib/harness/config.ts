import { buildClaudePermissionArgs } from "@/lib/harness/claude-permissions";
import type { HarnessExecutionMode } from "@/lib/harness/claude-permissions";
import { buildCodexPermissionArgs } from "@/lib/harness/codex-permissions";
import type { FlowAgentHarness } from "@/lib/types";

export type HarnessId = Exclude<FlowAgentHarness, "mogplex">;
export type HarnessProvider = "anthropic" | "openai";

/**
 * The Agent Client Protocol server Mogplex drives this harness through. When
 * present (and not switched off, see `resolveHarnessAcpAgent` in
 * `lib/harness/acp/agent.ts`), runs
 * launch this package behind the in-sandbox ACP bridge instead of the CLI's
 * one-shot `buildCommand` invocation.
 */
export type HarnessAcpAgent = {
  package: string;
  version: string;
  binary: string;
};

export type HarnessConfig = {
  id: HarnessId;
  name: string;
  provider: HarnessProvider;
  package: string;
  version: string;
  binary: string;
  envVar: string;
  buildCommand: (
    prompt: string,
    opts?: {
      continue?: boolean;
      resumeSessionId?: string | null;
      mode?: HarnessExecutionMode;
      mcpConfigPath?: string;
      mcpServerNames?: string[];
      mogplexServerName?: string;
    }
  ) => { cmd: string; args: string[] };
  timeoutMs: number;
  acp?: HarnessAcpAgent;
};

export const HARNESSES: Record<HarnessId, HarnessConfig> = {
  "claude-code": {
    id: "claude-code",
    name: "Claude Code",
    provider: "anthropic",
    package: "@anthropic-ai/claude-code",
    version: "2.1.222",
    binary: "claude",
    envVar: "ANTHROPIC_API_KEY",
    buildCommand: (prompt, opts) => {
      const resumeSessionId = opts?.resumeSessionId?.trim();
      const mcpArgs = opts?.mcpConfigPath
        ? ["--mcp-config", opts.mcpConfigPath, "--strict-mcp-config"]
        : [];
      const args = [
        ...(resumeSessionId
          ? [
              "--resume",
              resumeSessionId,
              "-p",
              prompt,
              "--verbose",
              "--output-format",
              "stream-json",
            ]
          : opts?.continue
            ? [
                "--continue",
                "-p",
                prompt,
                "--verbose",
                "--output-format",
                "stream-json",
              ]
            : ["-p", prompt, "--verbose", "--output-format", "stream-json"]),
        ...mcpArgs,
        ...buildClaudePermissionArgs(opts?.mode, {
          mcpServerNames: opts?.mcpServerNames,
          mogplexServerName: opts?.mogplexServerName,
        }),
      ];
      return { cmd: "claude", args };
    },
    timeoutMs: 5 * 60 * 1000,
  },
  codex: {
    id: "codex",
    name: "Codex",
    provider: "openai",
    package: "@openai/codex",
    version: "0.146.1",
    binary: "codex",
    envVar: "CODEX_API_KEY",
    buildCommand: (prompt, opts) => ({
      cmd: "codex",
      args: [
        ...buildCodexPermissionArgs(opts?.mode),
        ...(opts?.resumeSessionId?.trim()
          ? ["exec", "resume", "--json", opts.resumeSessionId.trim(), prompt]
          : ["exec", "--json", prompt]),
      ],
    }),
    timeoutMs: 5 * 60 * 1000,
    // Bundles its own compatible @openai/codex, which it runs as an app server.
    acp: {
      package: "@agentclientprotocol/codex-acp",
      version: "2.0.0",
      binary: "codex-acp",
    },
  },
};

export function getHarnessConfig(id: HarnessId): HarnessConfig {
  const config = HARNESSES[id];
  if (!config) throw new Error(`Unknown harness: ${id}`);
  return config;
}
