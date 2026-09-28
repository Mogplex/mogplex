import type { HarnessExecutionMode } from "@/lib/harness/claude-permissions";
import {
  CODEX_GATEWAY_PROVIDER_ID,
  CODEX_WORKER_FEATURES,
  codexProviderConfig,
} from "@/lib/harness/codex-provider";
import { getHarnessConfig } from "@/lib/harness/config";
import type { HarnessAcpAgent, HarnessId } from "@/lib/harness/config";

/**
 * The ACP agent a harness runs through, or null for the one-shot CLI path.
 * Harnesses with an `acp` pin use it by default; `MOGPLEX_HARNESS_ACP=off`
 * returns every harness to its CLI invocation without a deploy of new code.
 */
export function resolveHarnessAcpAgent(
  harnessId: HarnessId,
  env: Record<string, string | undefined> = process.env
): HarnessAcpAgent | null {
  const agent = getHarnessConfig(harnessId).acp;
  if (!agent) return null;
  const setting = env.MOGPLEX_HARNESS_ACP?.trim().toLowerCase();
  return setting === "off" || setting === "false" || setting === "0"
    ? null
    : agent;
}

export type AcpPermissionDecision = "allow" | "decline";

/**
 * How the bridge answers `session/request_permission`. Workers have nobody to
 * ask, so every request is decided by the run mode. MCP tools come only from
 * connections the user set to run without asking (ask-mode connections never
 * reach a harness), so they are always approved. Anything else is approved
 * only in YOLO; otherwise the agent continues without running it, which is
 * what `approval_policy="never"` meant on the CLI path.
 */
export function acpPermissionPolicy(mode?: HarnessExecutionMode): {
  mcp: AcpPermissionDecision;
  other: AcpPermissionDecision;
} {
  return { mcp: "allow", other: mode === "YOLO" ? "allow" : "decline" };
}

/** codex-acp's session mode ids: each is an approval + sandbox preset. */
export function codexAcpModeId(mode?: HarnessExecutionMode): string {
  if (mode === "SAFE") return "read-only";
  if (mode === "YOLO") return "agent-full-access";
  return "workspace-write";
}

/**
 * How the bridge signs the agent in: codex-acp's `gateway` method, which
 * configures the model endpoint in the agent's memory. Its API-key method
 * would persist the key under `~/.codex` in a sandbox the user can open.
 * The bridge reads the key from `apiKeyEnv` and withholds it from the agent.
 */
export type AcpGatewayAuth = {
  type: "gateway";
  baseUrl: string;
  providerName: string;
  apiKeyEnv: string;
};

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

export function codexAcpAuth(env: Record<string, string>): AcpGatewayAuth {
  const provider =
    codexProviderConfig(env)?.model_providers[CODEX_GATEWAY_PROVIDER_ID];
  if (provider) {
    return {
      type: "gateway",
      baseUrl: provider.base_url,
      providerName: provider.name,
      apiKeyEnv: provider.env_key,
    };
  }
  // A direct OpenAI key, or the user's own OpenAI-compatible endpoint.
  return {
    type: "gateway",
    baseUrl: env.OPENAI_BASE_URL?.trim() || OPENAI_API_BASE_URL,
    providerName: "OpenAI",
    apiKeyEnv: "CODEX_API_KEY",
  };
}

/**
 * Environment for `codex-acp`: the gateway model and worker isolation that
 * the CLI path passes as `-c` flags travel as `CODEX_CONFIG`.
 */
export function codexAcpEnv(
  env: Record<string, string>,
  mode?: HarnessExecutionMode
): Record<string, string> {
  const provider = codexProviderConfig(env);
  return {
    CODEX_CONFIG: JSON.stringify({
      ...(provider ? { model: provider.model } : {}),
      features: CODEX_WORKER_FEATURES,
    }),
    INITIAL_AGENT_MODE: codexAcpModeId(mode),
    // A worker cannot open a browser for ChatGPT sign-in.
    NO_BROWSER: "1",
  };
}
