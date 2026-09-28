const GATEWAY_OPENAI_BASE_URL = "https://ai-gateway.vercel.sh/v1";
export const CODEX_GATEWAY_PROVIDER_ID = "mogplex_gateway";

/**
 * Codex selects providers from config, not the OpenAI SDK environment alone.
 * Returns the gateway provider settings when the run is gateway-billed, or
 * null for a direct OpenAI key or a user-configured provider.
 */
export function codexProviderConfig(env: Record<string, string>) {
  if (env.OPENAI_BASE_URL !== GATEWAY_OPENAI_BASE_URL) return null;

  // The compatibility endpoint supplies Codex models and tool capabilities as
  // well as the Responses API. The key stays in the environment (`env_key`).
  return {
    model_provider: CODEX_GATEWAY_PROVIDER_ID,
    model: "openai/gpt-5.6-sol",
    model_providers: {
      [CODEX_GATEWAY_PROVIDER_ID]: {
        name: "Mogplex AI Gateway",
        base_url: "https://ai-gateway.vercel.sh/codex/v1",
        env_key: "CODEX_API_KEY",
        wire_api: "responses",
      },
    },
  };
}

/** The provider as `codex -c` overrides for the one-shot `codex exec` path. */
export function codexProviderArgs(env: Record<string, string>): string[] {
  const config = codexProviderConfig(env);
  if (!config) return [];

  // Command-scoped overrides leave persisted sessions/config untouched and keep
  // credentials out of argv.
  const provider = config.model_providers[CODEX_GATEWAY_PROVIDER_ID];
  const prefix = `model_providers.${CODEX_GATEWAY_PROVIDER_ID}`;
  return [
    `model_provider="${config.model_provider}"`,
    `model="${config.model}"`,
    `${prefix}.name="${provider.name}"`,
    `${prefix}.base_url="${provider.base_url}"`,
    `${prefix}.env_key="${provider.env_key}"`,
    `${prefix}.wire_api="${provider.wire_api}"`,
  ].flatMap((value) => ["-c", value]);
}

/**
 * A Mogplex worker is exactly one agent. Codex's `multi_agent` feature
 * (stable and on by default in the pinned 0.146.1 and in 0.153.4) lets a
 * worker spawn collaborator threads; five workers doing that in one 4 GB
 * sandbox killed the VM in mission 43f98333.
 */
export const CODEX_WORKER_FEATURES = { multi_agent: false } as const;

export function codexWorkerIsolationArgs(): string[] {
  return ["-c", `features.multi_agent=${CODEX_WORKER_FEATURES.multi_agent}`];
}
