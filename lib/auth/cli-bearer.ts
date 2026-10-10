import type { ApiKeyResolution } from "@/lib/auth/api-key";
import {
  readStoredApiKeyAccess,
  type ApiKeyAccess,
} from "@/lib/mogplex-api/key-access";
import { MOGPLEX_CLI_OAUTH_CLIENT_ID } from "@/lib/better-auth/cli-token-ttl";

type BearerResolver = (
  authorization: string | null
) => Promise<ApiKeyResolution>;

type CliBearerAuth = {
  profileId: string;
  source: "api-key" | "oauth";
  /** What the key's owner allows it to do; set only for Mogplex API keys. */
  apiKeyAccess?: ApiKeyAccess;
};

type CliBearerDependencies = {
  resolveApiKey?: BearerResolver;
  resolveOAuthToken?: BearerResolver;
};

async function resolvePat(
  authorization: string,
  resolver?: BearerResolver
): Promise<CliBearerAuth | undefined> {
  const resolve =
    resolver ?? (await import("@/lib/auth/api-key")).resolveApiKey;
  const result = await resolve(authorization);
  return result.ok
    ? {
        profileId: result.auth.userId,
        source: "api-key",
        apiKeyAccess: readStoredApiKeyAccess(result.auth.access, {
          keyId: result.auth.keyId,
        }),
      }
    : undefined;
}

async function resolveOAuth(
  authorization: string,
  resolver?: BearerResolver
): Promise<CliBearerAuth | undefined> {
  const resolve =
    resolver ??
    (await import("@/lib/auth/mogplex-oauth")).resolveMogplexOAuthToken;
  const result = await resolve(authorization);
  if (!result.ok) return undefined;
  if (result.auth.keyId !== MOGPLEX_CLI_OAUTH_CLIENT_ID) return undefined;
  if (!result.auth.scopes.includes("read")) return undefined;
  if (!result.auth.scopes.includes("write")) return undefined;

  return { profileId: result.auth.userId, source: "oauth" };
}

export async function resolveCliBearerAuth(
  authorization: string | null,
  dependencies: CliBearerDependencies = {}
): Promise<CliBearerAuth | undefined> {
  if (!authorization?.startsWith("Bearer ")) return undefined;

  return authorization.startsWith("Bearer mog_")
    ? resolvePat(authorization, dependencies.resolveApiKey)
    : resolveOAuth(authorization, dependencies.resolveOAuthToken);
}
