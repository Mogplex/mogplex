// Self-hosted model endpoint (LiteLLM, vLLM, Ollama, or any server that speaks
// the OpenAI chat completions API), configured by the deployment operator
// through env vars. Its models are not stored in `ai_models`: they are merged
// into catalog reads with `withOpenAiCompatibleModels` and resolved directly,
// never through AI Gateway.
//
// MOGPLEX_OPENAI_COMPATIBLE_BASE_URL  e.g. http://litellm:4000/v1
// MOGPLEX_OPENAI_COMPATIBLE_API_KEY   optional
// MOGPLEX_OPENAI_COMPATIBLE_MODELS    comma-separated ids, optional `id=Label`

export const OPENAI_COMPATIBLE_PROVIDER = "openai-compatible";
const MODEL_ID_PREFIX = `${OPENAI_COMPATIBLE_PROVIDER}/`;

export type OpenAiCompatibleModel = {
  /** Catalog id, `openai-compatible/<upstream id>`. */
  id: string;
  /** The id sent to the endpoint. */
  upstreamId: string;
  name: string;
};

export type OpenAiCompatibleConfig = {
  baseURL: string;
  apiKey: string | null;
  models: OpenAiCompatibleModel[];
};

/** A full `ai_models`-shaped row, so every catalog select can accept it. */
export type OpenAiCompatibleCatalogRow = {
  id: string;
  provider: string;
  name: string;
  context_length: number | null;
  pricing_input: number | null;
  pricing_output: number | null;
  capabilities: string[];
  is_available: boolean;
  is_hidden: boolean;
  is_recommended: boolean;
  recommendation_bucket: "open" | "frontier" | null;
  recommendation_rank: number | null;
  recommendation_reason: string | null;
  recommended_at: string | null;
  created_at: string | null;
};

function parseBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? trimmed
      : null;
  } catch {
    return null;
  }
}

function parseModels(value: string | undefined): OpenAiCompatibleModel[] {
  const models = new Map<string, OpenAiCompatibleModel>();
  for (const entry of (value ?? "").split(",")) {
    const separator = entry.indexOf("=");
    const upstreamId = (
      separator === -1 ? entry : entry.slice(0, separator)
    ).trim();
    if (!upstreamId || models.has(upstreamId)) continue;
    const label = separator === -1 ? "" : entry.slice(separator + 1).trim();
    models.set(upstreamId, {
      id: `${MODEL_ID_PREFIX}${upstreamId}`,
      upstreamId,
      name: label || upstreamId,
    });
  }
  return [...models.values()];
}

/** Null when the base URL is unset or is not an absolute http(s) URL. */
export function readOpenAiCompatibleConfig(
  env: NodeJS.ProcessEnv = process.env
): OpenAiCompatibleConfig | null {
  const baseURL = parseBaseUrl(env.MOGPLEX_OPENAI_COMPATIBLE_BASE_URL);
  if (!baseURL) return null;
  return {
    baseURL,
    apiKey: env.MOGPLEX_OPENAI_COMPATIBLE_API_KEY?.trim() || null,
    models: parseModels(env.MOGPLEX_OPENAI_COMPATIBLE_MODELS),
  };
}

export function isOpenAiCompatibleModelId(modelId: string) {
  return modelId.trim().startsWith(MODEL_ID_PREFIX);
}

export function openAiCompatibleCatalogRows(
  env: NodeJS.ProcessEnv = process.env
): OpenAiCompatibleCatalogRow[] {
  const config = readOpenAiCompatibleConfig(env);
  if (!config) return [];
  return config.models.map((model) => ({
    id: model.id,
    provider: OPENAI_COMPATIBLE_PROVIDER,
    name: model.name,
    context_length: null,
    pricing_input: null,
    pricing_output: null,
    capabilities: [],
    is_available: true,
    is_hidden: false,
    is_recommended: false,
    recommendation_bucket: null,
    recommendation_rank: null,
    recommendation_reason: null,
    recommended_at: null,
    // No timestamp: the model never counts as a new arrival, so a user's
    // auto-enable-off switch does not hide the operator's endpoint.
    created_at: null,
  }));
}

/**
 * Appends the configured endpoint's models to catalog rows read from
 * `ai_models`. `toRow` adapts the full row to the caller's select shape. A DB
 * row with the same id wins.
 */
export function withOpenAiCompatibleModels<T extends { id: string }>(
  rows: readonly T[] | null | undefined,
  toRow: (row: OpenAiCompatibleCatalogRow) => T,
  env: NodeJS.ProcessEnv = process.env
): T[] {
  const catalog = [...(rows ?? [])];
  const ids = new Set(catalog.map((row) => row.id));
  for (const row of openAiCompatibleCatalogRows(env)) {
    if (!ids.has(row.id)) catalog.push(toRow(row));
  }
  return catalog;
}
