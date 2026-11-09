import { decrypt } from "./encryption";

export type OAuthCredentials = {
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  /** The code exchange that issued these tokens named the MCP resource. */
  resource_indicator?: true;
};

export function parseCredentials(encrypted: string): OAuthCredentials {
  const raw = decrypt(encrypted);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Only native OAuth fields are recognized. Unknown legacy broker payloads
    // intentionally parse without a token and must fail closed until reconnect.
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
      resource_indicator: parsed.resource_indicator === true ? true : undefined,
    };
  } catch {
    throw new Error("Invalid OAuth credentials format");
  }
}

export function parseCredentialsSafely(
  encrypted: string | null
): OAuthCredentials {
  if (!encrypted) {
    return {};
  }

  try {
    return parseCredentials(encrypted);
  } catch {
    return {};
  }
}
