import { normalizeCatalogModelName } from "@/lib/models/catalog-normalization";
import type { GatewayModel } from "./types";

export function buildStaleGatewayModelUpdate() {
  return {
    is_available: false,
    is_hidden: true,
    is_recommended: false,
    recommendation_bucket: null,
    recommendation_rank: null,
    recommendation_reason: null,
    recommended_at: null,
  };
}

export function parseFinitePrice(value: string | undefined) {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseFirstFinitePrice(...values: Array<string | undefined>) {
  for (const value of values) {
    const parsed = parseFinitePrice(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function mapGatewayPricing(pricing: GatewayModel["pricing"]) {
  return {
    pricing_input: parseFinitePrice(pricing?.input),
    pricing_output: parseFinitePrice(pricing?.output),
    pricing_cache_read: parseFirstFinitePrice(
      pricing?.cache_input,
      pricing?.cache_read,
      pricing?.input_cache_read
    ),
    pricing_cache_write: parseFirstFinitePrice(
      pricing?.cache_creation,
      pricing?.cache_write,
      pricing?.input_cache_write,
      pricing?.input_cache_creation
    ),
  };
}

export function mapGatewayModelToCatalogRow(model: GatewayModel) {
  return {
    id: model.id,
    provider: model.owned_by,
    name: normalizeCatalogModelName(model.id, model.name),
    context_length: model.context_window ?? null,
    capabilities: model.tags ?? [],
    ...mapGatewayPricing(model.pricing),
    is_available: true,
    is_recommended: false,
    recommendation_bucket: null as "open" | "frontier" | null,
    recommendation_rank: null as number | null,
    recommendation_reason: null as string | null,
    recommended_at: null as string | null,
    updated_at: new Date().toISOString(),
  };
}
