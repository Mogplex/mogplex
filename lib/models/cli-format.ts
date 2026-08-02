import type { AIModel } from "@/lib/types";

/**
 * CLI-facing model info shape.
 *
 * Mirrors `ModelInfoSchema` in the mogplex CLI workspace
 * (`packages/core/src/provider.ts`). Kept as a local type so the Next.js
 * app doesn't need a workspace dependency on the CLI packages.
 *
 * Anytime the CLI schema changes, this type + `toCliModelInfo` must be
 * kept in sync (see tests/unit/models-route-cli-format.test.ts).
 */
export type CliInputModality = "text" | "image" | "audio";

export type CliModelCaps = {
  toolUse: boolean;
  streaming: boolean;
  reasoningEffort: boolean;
  parallelToolCalls: boolean;
};

export type CliModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
  currency: "USD";
};

export type CliModelInfo = {
  slug: string;
  provider: string;
  displayName: string;
  description?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputModalities: CliInputModality[];
  caps: CliModelCaps;
  pricing?: CliModelPricing;
  supportsPersonality?: boolean;
  autoCompactTokenLimit?: number;
};

const TOOL_USE_CAPABILITY_TAGS = new Set([
  "tool-use",
  "tool_use",
  "tools",
  "function-calling",
  "function_calling",
]);

const REASONING_CAPABILITY_TAGS = new Set(["reasoning", "thinking"]);

const VISION_CAPABILITY_TAGS = new Set([
  "vision",
  "image",
  "image-input",
  "multimodal",
]);

const AUDIO_CAPABILITY_TAGS = new Set(["audio", "audio-input", "speech"]);

function normalizeTags(capabilities: AIModel["capabilities"]): Set<string> {
  return new Set((capabilities ?? []).map((tag) => tag.toLowerCase()));
}

function hasAny(tags: Set<string>, candidates: Set<string>): boolean {
  for (const tag of tags) {
    if (candidates.has(tag)) return true;
  }
  return false;
}

function perMillion(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value * 1_000_000;
}

/**
 * Convert a catalog `AIModel` row into the CLI's `ModelInfo` shape.
 *
 * Pricing in the catalog is stored as per-token USD (as synced from the
 * Vercel AI Gateway). The CLI expects per-million-token rates, so we
 * multiply by 1e6 when both sides are present.
 */
export function toCliModelInfo(model: AIModel): CliModelInfo {
  const tags = normalizeTags(model.capabilities);

  const toolUse = hasAny(tags, TOOL_USE_CAPABILITY_TAGS);
  const reasoningEffort = hasAny(tags, REASONING_CAPABILITY_TAGS);
  const vision = hasAny(tags, VISION_CAPABILITY_TAGS);
  const audio = hasAny(tags, AUDIO_CAPABILITY_TAGS);

  const inputModalities: CliInputModality[] = ["text"];
  if (vision) inputModalities.push("image");
  if (audio) inputModalities.push("audio");

  const info: CliModelInfo = {
    slug: model.id,
    provider: model.provider,
    displayName: model.name,
    inputModalities,
    caps: {
      // Every gateway-backed model streams over the AI SDK, and we assume
      // non-streaming providers aren't exposed through this catalog.
      streaming: true,
      toolUse,
      reasoningEffort,
      // Catalog doesn't currently surface this; default to toolUse as a
      // conservative proxy (most frontier tool-use models parallelize).
      parallelToolCalls: toolUse,
    },
  };

  if (typeof model.context_length === "number") {
    info.contextWindow = model.context_length;
  }

  const inputPerMillion = perMillion(model.pricing_input);
  const outputPerMillion = perMillion(model.pricing_output);
  if (inputPerMillion !== null && outputPerMillion !== null) {
    info.pricing = {
      inputPerMillion,
      outputPerMillion,
      currency: "USD",
    };
  }

  return info;
}

export function toCliModelInfoList(models: AIModel[]): CliModelInfo[] {
  return models.map(toCliModelInfo);
}
