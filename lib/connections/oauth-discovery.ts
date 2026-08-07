import { createHash, randomBytes } from "node:crypto";
import { assertSafeOutboundHttpUrlWithDns } from "@/lib/security/outbound-url";

export type OAuthMetadata = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
};

export type DynamicClientRegistration = {
  client_id: string;
  client_secret?: string;
};

function base64UrlEncode(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/g, "");
}

export function generatePkceVerifier() {
  return base64UrlEncode(randomBytes(32));
}

export function generatePkceChallenge(verifier: string) {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

async function fetchJson(url: string, init?: RequestInit, fieldName = "url") {
  const safeUrl = await assertSafeOutboundHttpUrlWithDns(url, fieldName);
  const response = await fetch(safeUrl, init);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${safeUrl}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

async function discoverProtectedResourceMetadata(mcpServerUrl: string) {
  const url = new URL(
    await assertSafeOutboundHttpUrlWithDns(mcpServerUrl, "mcp_url")
  );
  const adjacentUrl = new URL(
    ".well-known/oauth-protected-resource",
    url.toString().endsWith("/") ? url : `${url.toString()}/`
  );

  try {
    return await fetchJson(
      adjacentUrl.toString(),
      {
        headers: {
          "MCP-Protocol-Version": "2025-03-26",
        },
      },
      "oauth_protected_resource"
    );
  } catch {
    const pathAware = new URL(
      `/.well-known/oauth-protected-resource${url.pathname}`,
      url
    );
    return fetchJson(
      pathAware.toString(),
      {
        headers: {
          "MCP-Protocol-Version": "2025-03-26",
        },
      },
      "oauth_protected_resource"
    );
  }
}

export async function discoverOAuthMetadata(
  mcpServerUrl: string
): Promise<OAuthMetadata> {
  const protectedResource =
    await discoverProtectedResourceMetadata(mcpServerUrl);
  const authorizationServers = protectedResource.authorization_servers;
  if (
    !Array.isArray(authorizationServers) ||
    typeof authorizationServers[0] !== "string"
  ) {
    throw new TypeError(
      "No authorization servers found in protected resource metadata"
    );
  }

  const metadataUrl = new URL(
    "/.well-known/oauth-authorization-server",
    authorizationServers[0]
  );
  const metadata = (await fetchJson(
    metadataUrl.toString(),
    undefined,
    "oauth_authorization_server"
  )) as OAuthMetadata;
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error(
      "Missing required OAuth endpoints in authorization metadata"
    );
  }

  return {
    authorization_endpoint: metadata.authorization_endpoint,
    token_endpoint: metadata.token_endpoint,
    registration_endpoint: metadata.registration_endpoint,
  };
}

export async function registerOAuthClient(
  metadata: OAuthMetadata,
  redirectUri: string,
  options: {
    clientName: string;
    clientUri: string;
    tokenEndpointAuthMethod: "none" | "client_secret_post";
    scopes?: string[];
  }
): Promise<DynamicClientRegistration> {
  if (!metadata.registration_endpoint) {
    throw new Error(
      "OAuth server does not support dynamic client registration"
    );
  }

  const registrationEndpoint = await assertSafeOutboundHttpUrlWithDns(
    metadata.registration_endpoint,
    "registration_endpoint"
  );
  const response = await fetch(registrationEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_name: options.clientName,
      client_uri: options.clientUri,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: options.tokenEndpointAuthMethod,
      ...(options.scopes?.length ? { scope: options.scopes.join(" ") } : {}),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Client registration failed (${response.status}): ${errorBody}`
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  if (typeof payload.client_id !== "string" || !payload.client_id) {
    throw new Error("Dynamic client registration did not return client_id");
  }

  return {
    client_id: payload.client_id,
    client_secret:
      typeof payload.client_secret === "string"
        ? payload.client_secret
        : undefined,
  };
}
