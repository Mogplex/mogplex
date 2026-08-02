// OpenRouter uses `:variant` suffixes on model slugs (e.g. `:nitro` for
// throughput-optimized routing, `:floor` for cheapest, `:thinking`, `:online`,
// `:free`, `:extended`, `:beta`). `:nitro` is OpenRouter's equivalent of the
// AI Gateway's `provider.sort = "tps"` — it sorts providers by tokens/sec.
// Apply it by default; respect any explicitly specified variant.
// Ref: https://openrouter.ai/docs/features/provider-routing#nitro-shortcut
export function applyOpenRouterNitro(modelId: string): string {
  if (modelId.includes(":")) return modelId;
  return `${modelId}:nitro`;
}
