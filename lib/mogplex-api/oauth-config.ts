import { getCanonicalAppUrl } from "@/lib/app-url";

const MOGPLEX_MCP_PATH = "/api/v1/mogplex/mcp";
const MOGPLEX_MCP_PROTECTED_RESOURCE_PATH =
  "/.well-known/oauth-protected-resource/api/v1/mogplex/mcp";

function requireSupabaseUrl() {
  const value =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!value) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required for Mogplex OAuth");
  }
  return new URL(value);
}

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

export function getSupabaseOAuthIssuer() {
  return new URL("/auth/v1", requireSupabaseUrl())
    .toString()
    .replace(/\/$/, "");
}

export function getSupabaseOAuthJwksUrl() {
  return `${getSupabaseOAuthIssuer()}/.well-known/jwks.json`;
}

export function buildMogplexMcpBearerChallenge(request: Request) {
  return `Bearer resource_metadata="${getMogplexMcpProtectedResourceMetadataUrl(request)}"`;
}

export function buildMogplexMcpProtectedResourceMetadata(request?: Request) {
  return {
    resource: getMogplexMcpResourceUrl(request),
    authorization_servers: [getSupabaseOAuthIssuer()],
    resource_documentation:
      "https://github.com/mogplex/mogplex/blob/main/docs/mogplex-api-mcp/local-agent-automation.md",
  };
}
