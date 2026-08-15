import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertSafeOutboundHttpUrlWithDns } from "@/lib/security/outbound-url";
import { encrypt, decrypt } from "./encryption";
import { updateConnection } from "./service";
import { getConnectionPreset } from "./presets";
import {
  discoverOAuthMetadata,
  registerOAuthClient,
  generatePkceVerifier,
} from "./oauth-discovery";
import type { OAuthMetadata } from "./oauth-discovery";
import type { Connection } from "@/lib/types";

// Re-export discovery functions for API compatibility
export {
  generatePkceVerifier,
  generatePkceChallenge,
  discoverOAuthMetadata,
} from "./oauth-discovery";

type OAuthCredentials = {
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
};

export type OAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

export type StoredOAuthConnectionState = {
  encrypted_credentials: string | null;
  updated_at: string;
  oauth_authorized_at: string | null;
  oauth_token_expires_at: string | null;
};

function parseCredentials(encrypted: string): OAuthCredentials {
  const raw = decrypt(encrypted);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      client_secret:
        typeof parsed.client_secret === "string"
          ? parsed.client_secret
          : undefined,
      access_token:
        typeof parsed.access_token === "string"
          ? parsed.access_token
          : undefined,
      refresh_token:
        typeof parsed.refresh_token === "string"
          ? parsed.refresh_token
          : undefined,
    };
  } catch {
    throw new Error("Invalid OAuth credentials format");
  }
}

function parseCredentialsSafely(encrypted: string | null): OAuthCredentials {
  if (!encrypted) {
    return {};
  }

  try {
    return parseCredentials(encrypted);
  } catch {
    return {};
  }
}

async function getStoredOAuthConnectionState(
  connectionId: string
): Promise<StoredOAuthConnectionState | null> {
  const { data, error } = await supabaseAdmin
    .from("connections")
    .select(
      "encrypted_credentials, updated_at, oauth_authorized_at, oauth_token_expires_at"
    )
    .eq("id", connectionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

function getTokenExpiry(tokens: OAuthTokenResponse) {
  return tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;
}

export function canPrepareOAuthConnection(connection: Connection): boolean {
  if (connection.auth_type === "oauth") {
    return true;
  }

  return getConnectionPreset(connection.source_preset)?.auth_type === "oauth";
}

export async function prepareOAuthConnection(
  connection: Connection,
  options: {
    redirectUri: string;
    origin: string;
  }
): Promise<{ connection: Connection; codeVerifier: string | null }> {
  const preset = getConnectionPreset(connection.source_preset);
  if (!preset?.oauth_config) {
    return { connection, codeVerifier: null };
  }

  let nextConnection = { ...connection };
  let metadata: OAuthMetadata | null = null;
  const oauthScopes =
    preset.oauth_config.scopes?.join(" ") ?? nextConnection.oauth_scopes;

  if (!nextConnection.oauth_authorize_url || !nextConnection.oauth_token_url) {
    metadata = await discoverOAuthMetadata(nextConnection.mcp_url!);
    await updateConnection(nextConnection.id, {
      oauth_authorize_url: metadata.authorization_endpoint,
      oauth_token_url: metadata.token_endpoint,
      oauth_scopes: oauthScopes,
    });
    nextConnection = {
      ...nextConnection,
      oauth_authorize_url: metadata.authorization_endpoint,
      oauth_token_url: metadata.token_endpoint,
      oauth_scopes: oauthScopes ?? null,
    };
  }

  if (!nextConnection.oauth_client_id) {
    metadata ??= await discoverOAuthMetadata(nextConnection.mcp_url!);
    const registration = await registerOAuthClient(
      metadata,
      options.redirectUri,
      {
        clientName: "Mogplex",
        clientUri: options.origin,
        tokenEndpointAuthMethod: preset.oauth_config.token_endpoint_auth_method,
        scopes: preset.oauth_config.scopes,
      }
    );

    const credentials = registration.client_secret
      ? JSON.stringify({ client_secret: registration.client_secret })
      : undefined;

    await updateConnection(nextConnection.id, {
      oauth_client_id: registration.client_id,
      oauth_authorize_url: metadata.authorization_endpoint,
      oauth_token_url: metadata.token_endpoint,
      oauth_scopes: oauthScopes,
      ...(credentials ? { credentials } : {}),
    });

    nextConnection = {
      ...nextConnection,
      oauth_client_id: registration.client_id,
      oauth_authorize_url: metadata.authorization_endpoint,
      oauth_token_url: metadata.token_endpoint,
      oauth_scopes: oauthScopes ?? null,
    };
  }

  if (nextConnection.oauth_scopes !== (oauthScopes ?? null)) {
    await updateConnection(nextConnection.id, {
      oauth_scopes: oauthScopes ?? null,
    });
    nextConnection = {
      ...nextConnection,
      oauth_scopes: oauthScopes ?? null,
    };
  }

  return {
    connection: nextConnection,
    codeVerifier: preset.oauth_config.use_pkce ? generatePkceVerifier() : null,
  };
}

async function compareAndSwapOAuthConnectionState(
  connectionId: string,
  current: StoredOAuthConnectionState,
  tokens: OAuthTokenResponse
) {
  const nextCredentials: OAuthCredentials = {
    ...parseCredentialsSafely(current.encrypted_credentials),
    access_token: tokens.access_token,
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
  };

  const update: Record<string, unknown> = {
    auth_type: "oauth",
    encrypted_credentials: encrypt(JSON.stringify(nextCredentials)),
    oauth_authorized_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const expiresAt = getTokenExpiry(tokens);
  if (expiresAt) {
    update.oauth_token_expires_at = expiresAt;
  }

  const { data, error } = await supabaseAdmin
    .from("connections")
    .update(update)
    .eq("id", connectionId)
    .eq("updated_at", current.updated_at)
    .select(
      "encrypted_credentials, updated_at, oauth_authorized_at, oauth_token_expires_at"
    )
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as StoredOAuthConnectionState | null;
}

export async function storeOAuthTokensWithRetry(
  connectionId: string,
  initialState: StoredOAuthConnectionState,
  tokens: OAuthTokenResponse
): Promise<StoredOAuthConnectionState | null> {
  let current: StoredOAuthConnectionState | null = initialState;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!current) {
      return null;
    }

    const updated = await compareAndSwapOAuthConnectionState(
      connectionId,
      current,
      tokens
    );
    if (updated) {
      return updated;
    }

    current = await getStoredOAuthConnectionState(connectionId);
  }

  return null;
}

/** Build the OAuth authorize URL with state + redirect */
export function buildAuthorizeUrl(
  connection: Connection,
  redirectUri: string,
  state: string,
  options?: {
    codeChallenge?: string;
    authorizeParams?: Record<string, string>;
    resource?: string;
  }
): string {
  const url = new URL(connection.oauth_authorize_url!);
  url.searchParams.set("client_id", connection.oauth_client_id!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (connection.oauth_scopes) {
    url.searchParams.set("scope", connection.oauth_scopes);
  }
  if (options?.codeChallenge) {
    url.searchParams.set("code_challenge", options.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (options?.resource) {
    url.searchParams.set("resource", options.resource);
  }
  for (const [key, value] of Object.entries(options?.authorizeParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Exchange authorization code for tokens */
export async function exchangeCodeForTokens(
  connection: Connection,
  code: string,
  redirectUri: string,
  options?: {
    codeVerifier?: string | null;
  }
): Promise<OAuthTokenResponse> {
  const { data } = await supabaseAdmin
    .from("connections")
    .select("encrypted_credentials")
    .eq("id", connection.id)
    .single();

  const creds = parseCredentialsSafely(data?.encrypted_credentials ?? null);

  if (!creds.client_secret && !options?.codeVerifier) {
    throw new Error("No credentials found for OAuth connection");
  }

  const tokenUrl = await assertSafeOutboundHttpUrlWithDns(
    connection.oauth_token_url!,
    "oauth_token_url"
  );
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: connection.oauth_client_id!,
      code,
      redirect_uri: redirectUri,
      ...(connection.type === "mcp_server" && connection.mcp_url
        ? { resource: connection.mcp_url }
        : {}),
      ...(creds.client_secret ? { client_secret: creds.client_secret } : {}),
      ...(options?.codeVerifier ? { code_verifier: options.codeVerifier } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token exchange failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json.access_token !== "string") {
    throw new TypeError("Invalid token response: missing access_token");
  }

  return {
    access_token: json.access_token,
    refresh_token:
      typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    expires_in:
      typeof json.expires_in === "number" ? json.expires_in : undefined,
  };
}

/** Refresh an expired OAuth token */
export async function refreshOAuthToken(
  connection: Connection
): Promise<string> {
  const current = await getStoredOAuthConnectionState(connection.id);

  if (!current?.encrypted_credentials) {
    throw new Error("No credentials found for OAuth connection");
  }

  const creds = parseCredentials(current.encrypted_credentials);
  if (!creds.refresh_token) {
    throw new Error("No refresh token available");
  }

  const tokenUrl = await assertSafeOutboundHttpUrlWithDns(
    connection.oauth_token_url!,
    "oauth_token_url"
  );
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: connection.oauth_client_id!,
      refresh_token: creds.refresh_token,
      ...(connection.type === "mcp_server" && connection.mcp_url
        ? { resource: connection.mcp_url }
        : {}),
      ...(creds.client_secret ? { client_secret: creds.client_secret } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token refresh failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json.access_token !== "string") {
    throw new TypeError("Invalid refresh response: missing access_token");
  }
  const tokens: OAuthTokenResponse = {
    access_token: json.access_token,
    refresh_token:
      typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    expires_in:
      typeof json.expires_in === "number" ? json.expires_in : undefined,
  };

  const stored = await storeOAuthTokensWithRetry(
    connection.id,
    current,
    tokens
  );
  if (stored) {
    const latest = parseCredentialsSafely(stored.encrypted_credentials);
    if (latest.access_token) {
      return latest.access_token;
    }
  }

  throw new Error("Failed to persist refreshed OAuth token");
}

/** Get a valid access token, refreshing if expired */
export async function getValidAccessToken(
  connection: Connection
): Promise<string> {
  const current = await getStoredOAuthConnectionState(connection.id);

  if (!current?.encrypted_credentials) {
    throw new Error("No credentials found for OAuth connection");
  }

  const creds = parseCredentials(current.encrypted_credentials);

  // Check if token is expired (with 60s buffer)
  // If no explicit expiry, assume 1 hour from last update as a conservative default
  const DEFAULT_TOKEN_LIFETIME_MS = 3600 * 1000;
  const expiresAt = current.oauth_token_expires_at
    ? new Date(current.oauth_token_expires_at).getTime()
    : current.updated_at
      ? new Date(current.updated_at).getTime() + DEFAULT_TOKEN_LIFETIME_MS
      : 0;

  if (expiresAt > 0 && Date.now() > expiresAt - 60_000) {
    if (creds.refresh_token) {
      return refreshOAuthToken(connection);
    }
    // No refresh token and expired — can't recover
    throw new Error(
      "OAuth token expired and no refresh token available — re-authorize required"
    );
  }

  if (creds.access_token) {
    return creds.access_token;
  }

  throw new Error(
    "OAuth connection has no access token — authorization required"
  );
}
