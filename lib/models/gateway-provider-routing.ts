import type { SystemModelMessage } from "ai";

// Vercel AI Gateway provider routing.
// Preserve throughput-first routing for every gateway call.
// Pin OSS-lab models to Fireworks (`order`) — fastest provider for these labs;
// soft preference, falls back to others if Fireworks is unavailable.
// Ref: https://vercel.com/docs/ai-gateway/models-and-providers/provider-filtering-and-ordering
const FIREWORKS_PINNED_LAB_PREFIXES = [
  "moonshotai/",
  "deepseek/",
  "minimax/",
] as const;

// Per-model provider pins (exact ID match). Like the prefix pins above this is
// a soft preference (`order`) — the gateway falls back to other providers if
// the pinned one is unavailable for the model. Keys must be lowercase.
const MODEL_PROVIDER_PINS: Record<string, string[]> = {
  // Baseten serves nemotron-3-ultra (alongside together-ai/deepinfra/blackbox).
  "nvidia/nemotron-3-ultra-550b-a55b": ["baseten"],
};

export type GatewayCallContext = {
  userId: string;
  tags?: string[];
  caching?: "auto" | "off";
};

export type GatewayProviderOptions = {
  gateway: {
    user: string;
    sort: "cost" | "ttft" | "tps";
    tags?: string[];
    order?: string[];
    models?: string[];
    caching?: "auto";
  };
};

function resolveGatewayFallbackModel(
  primaryModelId: string,
  fallbackModelIds: readonly string[]
) {
  const normalizedPrimary = primaryModelId.trim().toLowerCase();
  for (const fallbackModelId of fallbackModelIds) {
    const candidate = fallbackModelId.trim();
    if (candidate && candidate.toLowerCase() !== normalizedPrimary) {
      return candidate;
    }
  }

  return null;
}

export function gatewayProviderOptions(
  modelId: string,
  context: GatewayCallContext,
  fallbackModelIds: readonly string[] = []
): GatewayProviderOptions {
  const gateway: GatewayProviderOptions["gateway"] = {
    user: context.userId,
    sort: "tps",
  };
  const tags = context.tags
    ?.filter((tag) => tag.trim().length > 0)
    .slice(0, 10);
  if (tags?.length) {
    gateway.tags = tags;
  }

  const normalized = modelId.trim().toLowerCase();
  const fallbackModelId = resolveGatewayFallbackModel(
    normalized,
    fallbackModelIds
  );
  if (fallbackModelId) {
    // Keep the chain intentionally bounded. Automation can retry the complete
    // primary + fallback route once without multiplying provider cost/latency.
    gateway.models = [fallbackModelId];
  }

  const pinnedProviders = MODEL_PROVIDER_PINS[normalized];
  if (pinnedProviders) {
    gateway.order = pinnedProviders;
  } else {
    for (const prefix of FIREWORKS_PINNED_LAB_PREFIXES) {
      if (normalized.startsWith(prefix)) {
        gateway.order = ["fireworks"];
        break;
      }
    }
  }

  if (context.caching === "auto") {
    gateway.caching = "auto";
  }

  return { gateway };
}

// eslint-disable-next-line sonarjs/function-return-type -- AI SDK v6 accepts SystemModelMessage in `system`; off mode preserves the existing string prompt.
export function withGatewaySystemCaching(
  system: string,
  context: GatewayCallContext
): string | SystemModelMessage {
  if (context.caching !== "auto") return system;

  return {
    role: "system",
    content: system,
    providerOptions: {
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
    },
  };
}
