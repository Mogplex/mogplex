import { createOpenAI } from "@ai-sdk/openai";
import {
  OPENAI_COMPATIBLE_PROVIDER,
  readOpenAiCompatibleConfig,
} from "@/lib/models/openai-compatible-config";

/**
 * Builds the language model for `openai-compatible/<upstreamId>`. The API key
 * is always passed explicitly: the OpenAI provider would otherwise fall back to
 * the platform's `OPENAI_API_KEY` and send it to a third-party endpoint.
 */
export function resolveOpenAiCompatibleModel(
  upstreamId: string,
  options?: { fetch?: typeof fetch },
  env: NodeJS.ProcessEnv = process.env
) {
  const config = readOpenAiCompatibleConfig(env);
  if (!config) {
    throw new Error(
      "The OpenAI-compatible model endpoint is not configured. Set MOGPLEX_OPENAI_COMPATIBLE_BASE_URL."
    );
  }
  return createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey ?? "",
    name: OPENAI_COMPATIBLE_PROVIDER,
    fetch: options?.fetch,
  }).chat(upstreamId);
}
