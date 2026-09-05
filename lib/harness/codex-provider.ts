/** Codex selects providers from config, not the OpenAI SDK environment alone. */
export function codexProviderArgs(env: Record<string, string>): string[] {
  if (env.OPENAI_BASE_URL !== "https://ai-gateway.vercel.sh/v1") return [];

  // Command-scoped overrides leave persisted sessions/config untouched and keep
  // credentials out of argv. The compatibility endpoint supplies Codex models
  // and tool capabilities as well as the Responses API.
  return [
    'model_provider="mogplex_gateway"',
    'model="openai/gpt-5.6-sol"',
    'model_providers.mogplex_gateway.name="Mogplex AI Gateway"',
    'model_providers.mogplex_gateway.base_url="https://ai-gateway.vercel.sh/codex/v1"',
    'model_providers.mogplex_gateway.env_key="CODEX_API_KEY"',
    'model_providers.mogplex_gateway.wire_api="responses"',
  ].flatMap((value) => ["-c", value]);
}
