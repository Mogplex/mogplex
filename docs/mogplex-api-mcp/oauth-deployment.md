# Mogplex MCP OAuth deployment

The MCP resource is `https://mogplex.com/api/v1/mogplex/mcp`. Better Auth is the OAuth authorization server and publishes its endpoints from `https://mogplex.com/.well-known/oauth-authorization-server`.

## Better Auth configuration

The Better Auth MCP provider is mounted under `/api/auth/mcp/*`. It supports dynamic client registration, authorization code + PKCE, and refresh tokens. Its application, access-token, and consent records live in Neon and are created by `neon/migrations/20260805183000_better_auth_mcp_oauth.sql`.

The protected-resource metadata advertises the exact deployment resource plus the `read` and `write` scopes. Mogplex validates each opaque Better Auth access token against the provider's token store, rejects expired tokens, resolves the Better Auth user to a Mogplex profile, and enforces the granted API scopes.

## Verification

1. Read `/.well-known/oauth-protected-resource/api/v1/mogplex/mcp` and confirm the resource, `read`/`write` scopes, and `https://mogplex.com` authorization-server issuer.
2. Read `/.well-known/oauth-authorization-server` and confirm Better Auth's authorization, token, and dynamic registration endpoints are present.
3. Add the server with `codex mcp add` and run `codex mcp login mogplex`.
4. Confirm an unknown or expired token receives `401` with a `WWW-Authenticate` protected-resource metadata challenge.
5. After consent, list tools and run a read-only command before exercising a write tool.
