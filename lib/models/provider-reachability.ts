// Determine whether a catalog model id can actually be invoked by a user
// given the provider keys / platform access they have. Mirrors the routing
// rules in `lib/ai-model-resolver.ts`:
//   - openrouter/* requires a user OpenRouter key
//   - everything else is reachable via the AI Gateway
//   - openai/* and anthropic/* are also reachable via direct provider keys
//   - other labs (xai, moonshotai, deepseek, minimax, google, …) are
//     gateway-only at the moment

export type UserProviderAccess = {
  hasGateway: boolean;
  hasOpenAi: boolean;
  hasAnthropic: boolean;
  hasOpenRouter: boolean;
};

export function isModelReachable(
  modelId: string,
  access: UserProviderAccess
): boolean {
  const provider = modelId.split("/")[0];
  if (provider === "openrouter") return access.hasOpenRouter;
  if (access.hasGateway) return true;
  if (provider === "openai") return access.hasOpenAi;
  if (provider === "anthropic") return access.hasAnthropic;
  return false;
}

// Derive reachability flags from the set of provider key kinds available in a
// scope (own keys, and/or a team's keys) plus platform access. Platform AI only
// grants gateway access when a gateway key is actually configured server-side.
export function buildUserProviderAccess(
  providers: ReadonlySet<string>,
  opts: { allowPlatformAi: boolean }
): UserProviderAccess {
  return {
    hasGateway:
      providers.has("ai_gateway") ||
      (opts.allowPlatformAi && Boolean(process.env.AI_GATEWAY_API_KEY)),
    hasOpenAi: providers.has("openai"),
    hasAnthropic: providers.has("anthropic"),
    hasOpenRouter: providers.has("openrouter"),
  };
}
