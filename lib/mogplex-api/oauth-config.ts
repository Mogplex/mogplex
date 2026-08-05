import { getCanonicalAppUrl } from "@/lib/app-url";

const MOGPLEX_MCP_PATH = "/api/v1/mogplex/mcp";
const MOGPLEX_MCP_PROTECTED_RESOURCE_PATH =
  "/.well-known/oauth-protected-resource/api/v1/mogplex/mcp";

export function getMogplexMcpResourceUrl(request?: Request) {
  const configured = process.env.MOGPLEX_MCP_RESOURCE_URL?.trim();
  if (configured) return new URL(configured).toString();
  return new URL(MOGPLEX_MCP_PATH, getCanonicalAppUrl(request)).toString();
}

export function getMogplexMcpProtectedResourceMetadataUrl(request: Request) {
  return new URL(
    MOGPLEX_MCP_PROTECTED_RESOURCE_PATH,
    getCanonicalAppUrl(request)
  ).toString();
}

export function getMogplexOAuthIssuer(request?: Request) {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  if (configured) return new URL(configured).origin;
  return getCanonicalAppUrl(request).origin;
}

export function buildMogplexMcpBearerChallenge(request: Request) {
  return `Bearer resource_metadata="${getMogplexMcpProtectedResourceMetadataUrl(request)}"`;
}

export function buildMogplexMcpProtectedResourceMetadata(request?: Request) {
  return {
    resource: getMogplexMcpResourceUrl(request),
    authorization_servers: [getMogplexOAuthIssuer(request)],
    scopes_supported: ["read", "write"],
    resource_documentation:
      "https://github.com/mogplex/mogplex/blob/main/docs/mogplex-api-mcp/local-agent-automation.md",
  };
}
