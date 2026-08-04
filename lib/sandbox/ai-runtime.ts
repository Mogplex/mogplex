import {
  loadUserPlatformAccess,
  PLATFORM_ANTHROPIC_ACCESS_ERROR,
  PLATFORM_OPENAI_ACCESS_ERROR,
} from "@/lib/platform-access";
import { buildAIGatewayNetworkPolicy } from "@/lib/sandbox/client";
import { getProviderKey } from "@/lib/vault";
import type { Provider } from "@/lib/vault";
import type { HarnessId } from "@/lib/harness/config";

export type SandboxAiBillingSource =
  | "user_ai_gateway"
  | "platform_ai_gateway"
  | "direct_provider";

type SandboxAiProviderKeys = {
  anthropic: string | null;
  openai: string | null;
};

export type SandboxAiAccess = {
  aiBillingSource: SandboxAiBillingSource | null;
  gatewayApiKey: string | null;
  platformAccessRestricted: boolean;
  providerKeys: SandboxAiProviderKeys;
};

type SandboxAiEnvResolution =
  | {
      ok: true;
      aiBillingSource: SandboxAiBillingSource;
      env: Record<string, string>;
    }
  | {
      ok: false;
      error: string;
    };

type ResolveSandboxAiAccessDeps = {
  getProviderKey: (
    userId: string,
    provider: Provider
  ) => Promise<string | null>;
  getPlatformGatewayApiKey: () => string | null;
  loadUserPlatformAccess: (
    userId: string,
    productTeamId?: string | null
  ) => Promise<{ allowPlatformAi: boolean }>;
};

const defaultResolveSandboxAiAccessDeps: ResolveSandboxAiAccessDeps = {
  getProviderKey,
  loadUserPlatformAccess,
  getPlatformGatewayApiKey() {
    const value = process.env.AI_GATEWAY_API_KEY?.trim();
    return value && value.length > 0 ? value : null;
  },
};

export const AI_GATEWAY_OPENAI_BASE_URL = "https://ai-gateway.vercel.sh/v1";
export const AI_GATEWAY_ANTHROPIC_BASE_URL = "https://ai-gateway.vercel.sh";

function clearOpenAICompatEnv() {
  return {
    OPENAI_BASE_URL: "",
  };
}

function clearAnthropicCompatEnv() {
  return {
    ANTHROPIC_BASE_URL: "",
    ANTHROPIC_AUTH_TOKEN: "",
  };
}

export function createResolveSandboxAiAccess(
  overrides: Partial<ResolveSandboxAiAccessDeps> = {}
) {
  const deps: ResolveSandboxAiAccessDeps = {
    ...defaultResolveSandboxAiAccessDeps,
    ...overrides,
  };

  return async function resolveSandboxAiAccess(
    userId: string,
    productTeamId?: string | null
  ): Promise<SandboxAiAccess> {
    const [platformAccess, userGatewayKey, anthropicKey, openaiKey] =
      await Promise.all([
        deps.loadUserPlatformAccess(userId, productTeamId).catch(() => ({
          allowPlatformAi: false,
        })),
        deps.getProviderKey(userId, "ai_gateway").catch(() => null),
        deps.getProviderKey(userId, "anthropic").catch(() => null),
        deps.getProviderKey(userId, "openai").catch(() => null),
      ]);

    if (userGatewayKey) {
      return {
        aiBillingSource: "user_ai_gateway",
        gatewayApiKey: userGatewayKey,
        platformAccessRestricted: false,
        providerKeys: {
          anthropic: null,
          openai: null,
        },
      };
    }

    const platformGatewayKey = deps.getPlatformGatewayApiKey();
    if (platformGatewayKey && platformAccess.allowPlatformAi) {
      return {
        aiBillingSource: "platform_ai_gateway",
        gatewayApiKey: platformGatewayKey,
        platformAccessRestricted: false,
        providerKeys: {
          anthropic: null,
          openai: null,
        },
      };
    }

    return {
      aiBillingSource: anthropicKey || openaiKey ? "direct_provider" : null,
      gatewayApiKey: null,
      platformAccessRestricted:
        Boolean(platformGatewayKey) && !platformAccess.allowPlatformAi,
      providerKeys: {
        anthropic: anthropicKey,
        openai: openaiKey,
      },
    };
  };
}

export const resolveSandboxAiAccess = createResolveSandboxAiAccess();

export function buildSandboxTerminalAiEnv(access: SandboxAiAccess) {
  if (access.gatewayApiKey && access.aiBillingSource) {
    // Exec fallback commands use the generic shell path first and then overlay
    // harness-specific provider env when we detect `claude`/`codex`. Keeping
    // the base exec env OpenAI-compatible avoids leaking Anthropic gateway vars
    // into every non-harness command while still letting the PTY shell opt in
    // to Claude-compatible vars separately.
    return {
      aiBillingSource: access.aiBillingSource,
      env: {
        OPENAI_BASE_URL: AI_GATEWAY_OPENAI_BASE_URL,
        OPENAI_API_KEY: access.gatewayApiKey,
        CODEX_API_KEY: access.gatewayApiKey,
      },
    };
  }

  const env: Record<string, string> = {};
  let aiBillingSource: SandboxAiBillingSource | null = null;

  if (access.providerKeys.openai) {
    aiBillingSource = "direct_provider";
    Object.assign(env, clearOpenAICompatEnv(), {
      OPENAI_API_KEY: access.providerKeys.openai,
      CODEX_API_KEY: access.providerKeys.openai,
    });
  }

  if (access.providerKeys.anthropic) {
    aiBillingSource = "direct_provider";
    Object.assign(env, clearAnthropicCompatEnv(), {
      ANTHROPIC_API_KEY: access.providerKeys.anthropic,
    });
  }

  return {
    aiBillingSource,
    env,
  };
}

export function buildSandboxTerminalShellAiEnv(access: SandboxAiAccess) {
  const terminal = buildSandboxTerminalAiEnv(access);

  if (access.gatewayApiKey && access.aiBillingSource) {
    return {
      aiBillingSource: terminal.aiBillingSource,
      env: {
        ...terminal.env,
        ANTHROPIC_BASE_URL: AI_GATEWAY_ANTHROPIC_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: access.gatewayApiKey,
        ANTHROPIC_API_KEY: "",
      },
    };
  }

  return terminal;
}

export function buildSandboxHarnessAiEnv(
  access: SandboxAiAccess,
  harnessId: HarnessId
): SandboxAiEnvResolution {
  if (harnessId === "claude-code") {
    if (access.gatewayApiKey && access.aiBillingSource) {
      return {
        ok: true,
        aiBillingSource: access.aiBillingSource,
        env: {
          ANTHROPIC_BASE_URL: AI_GATEWAY_ANTHROPIC_BASE_URL,
          ANTHROPIC_AUTH_TOKEN: access.gatewayApiKey,
          ANTHROPIC_API_KEY: "",
        },
      };
    }

    if (access.providerKeys.anthropic) {
      return {
        ok: true,
        aiBillingSource: "direct_provider",
        env: {
          ...clearAnthropicCompatEnv(),
          ANTHROPIC_API_KEY: access.providerKeys.anthropic,
        },
      };
    }

    return {
      ok: false,
      error: access.platformAccessRestricted
        ? PLATFORM_ANTHROPIC_ACCESS_ERROR
        : "No Anthropic API key configured. Add one in Settings > API Keys or configure an AI Gateway key.",
    };
  }

  if (access.gatewayApiKey && access.aiBillingSource) {
    return {
      ok: true,
      aiBillingSource: access.aiBillingSource,
      env: {
        OPENAI_BASE_URL: AI_GATEWAY_OPENAI_BASE_URL,
        OPENAI_API_KEY: access.gatewayApiKey,
        CODEX_API_KEY: access.gatewayApiKey,
      },
    };
  }

  if (access.providerKeys.openai) {
    return {
      ok: true,
      aiBillingSource: "direct_provider",
      env: {
        ...clearOpenAICompatEnv(),
        OPENAI_API_KEY: access.providerKeys.openai,
        CODEX_API_KEY: access.providerKeys.openai,
      },
    };
  }

  return {
    ok: false,
    error: access.platformAccessRestricted
      ? PLATFORM_OPENAI_ACCESS_ERROR
      : "No OpenAI API key configured. Add one in Settings > API Keys or configure an AI Gateway key.",
  };
}

export function buildSandboxAiNetworkPolicy(access: SandboxAiAccess) {
  if (access.gatewayApiKey && access.aiBillingSource !== "direct_provider") {
    return buildAIGatewayNetworkPolicy({});
  }

  const providerKeys = Object.fromEntries(
    Object.entries(access.providerKeys).filter(
      ([, value]) => typeof value === "string" && value.length > 0
    )
  ) as Record<string, string>;

  if (Object.keys(providerKeys).length === 0) {
    return;
  }

  return buildAIGatewayNetworkPolicy(providerKeys);
}
