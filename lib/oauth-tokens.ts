import { supabaseAdmin } from "@/lib/supabase/admin";

export type OAuthProvider = "github" | "vercel";

type RpcResult = {
  data: unknown;
  error: { message: string } | null;
};

type LegacyOAuthTokens = Record<OAuthProvider, string | null>;

type OAuthTokenStoreDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  loadLegacyTokens: (userId: string) => Promise<LegacyOAuthTokens>;
  clearLegacyToken: (userId: string, provider: OAuthProvider) => Promise<void>;
  logger?: Pick<typeof console, "error">;
};

const LEGACY_COLUMN_BY_PROVIDER: Record<
  OAuthProvider,
  "github_token" | "vercel_token"
> = {
  github: "github_token",
  vercel: "vercel_token",
};

function normalizeToken(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function loadLegacyTokens(userId: string): Promise<LegacyOAuthTokens> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("github_token, vercel_token")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load legacy OAuth tokens: ${error.message}`);
  }

  return {
    github: normalizeToken(data?.github_token),
    vercel: normalizeToken(data?.vercel_token),
  };
}

async function clearLegacyToken(userId: string, provider: OAuthProvider) {
  const legacyColumn = LEGACY_COLUMN_BY_PROVIDER[provider];
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ [legacyColumn]: null })
    .eq("id", userId);

  if (error) {
    throw new Error(
      `Failed to clear legacy ${provider} token: ${error.message}`
    );
  }
}

export function createOAuthTokenStore(deps: OAuthTokenStoreDeps) {
  const logger = deps.logger ?? console;

  async function storeOAuthToken(
    userId: string,
    provider: OAuthProvider,
    token: string
  ) {
    const normalizedToken = normalizeToken(token);
    if (!normalizedToken) {
      throw new Error(`Cannot store blank ${provider} OAuth token`);
    }

    const { error } = await deps.rpc("store_oauth_token", {
      p_user_id: userId,
      p_provider: provider,
      p_token: normalizedToken,
    });
    if (error) {
      throw new Error(
        `Failed to store ${provider} OAuth token: ${error.message}`
      );
    }

    await deps.clearLegacyToken(userId, provider);
  }

  async function migrateLegacyOAuthToken(
    userId: string,
    provider: OAuthProvider
  ) {
    const legacyTokens = await deps.loadLegacyTokens(userId);
    const legacyToken = legacyTokens[provider];

    if (!legacyToken) {
      return null;
    }

    await storeOAuthToken(userId, provider, legacyToken);
    return legacyToken;
  }

  async function migrateLegacyOAuthTokensForUser(userId: string) {
    const legacyTokens = await deps.loadLegacyTokens(userId);

    for (const provider of Object.keys(legacyTokens) as OAuthProvider[]) {
      const token = legacyTokens[provider];
      if (!token) continue;
      await storeOAuthToken(userId, provider, token);
    }
  }

  async function getOAuthToken(
    userId: string,
    provider: OAuthProvider
  ): Promise<string | null> {
    const { data, error } = await deps.rpc("get_oauth_token", {
      p_user_id: userId,
      p_provider: provider,
    });
    if (error) {
      throw new Error(
        `Failed to get ${provider} OAuth token: ${error.message}`
      );
    }

    const token = normalizeToken(data);
    if (token) {
      return token;
    }

    return migrateLegacyOAuthToken(userId, provider);
  }

  async function hasOAuthToken(userId: string, provider: OAuthProvider) {
    const { data, error } = await deps.rpc("has_oauth_token", {
      p_user_id: userId,
      p_provider: provider,
    });
    if (error) {
      throw new Error(
        `Failed to check ${provider} OAuth token: ${error.message}`
      );
    }

    if (data) {
      return true;
    }

    const legacyTokens = await deps.loadLegacyTokens(userId);
    return Boolean(legacyTokens[provider]);
  }

  async function deleteOAuthToken(userId: string, provider: OAuthProvider) {
    const { error } = await deps.rpc("delete_oauth_token", {
      p_user_id: userId,
      p_provider: provider,
    });
    if (error) {
      throw new Error(
        `Failed to delete ${provider} OAuth token: ${error.message}`
      );
    }

    try {
      await deps.clearLegacyToken(userId, provider);
    } catch (clearError) {
      logger.error("[oauth-tokens] failed to clear legacy token after delete", {
        userId,
        provider,
        error: clearError,
      });
    }
  }

  return {
    deleteOAuthToken,
    getOAuthToken,
    hasOAuthToken,
    migrateLegacyOAuthToken,
    migrateLegacyOAuthTokensForUser,
    storeOAuthToken,
  };
}

const defaultOAuthTokenStore = createOAuthTokenStore({
  rpc: async (fn, args) => supabaseAdmin.rpc(fn, args),
  loadLegacyTokens,
  clearLegacyToken,
});

export const { deleteOAuthToken } = defaultOAuthTokenStore;
export const { getOAuthToken } = defaultOAuthTokenStore;
export const { hasOAuthToken } = defaultOAuthTokenStore;
export const { migrateLegacyOAuthToken } = defaultOAuthTokenStore;
export const { migrateLegacyOAuthTokensForUser } = defaultOAuthTokenStore;
export const { storeOAuthToken } = defaultOAuthTokenStore;
