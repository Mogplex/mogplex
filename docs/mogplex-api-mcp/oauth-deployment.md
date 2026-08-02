# Mogplex MCP OAuth deployment

The MCP resource is `https://www.mogplex.com/api/v1/mogplex/mcp`. Supabase Auth is the OAuth 2.1 authorization server and Mogplex owns the consent screen at `/oauth/consent`.

## Supabase Auth configuration

Enable the OAuth server and dynamic client registration for project `<your-project-ref>`:

```json
{
  "oauth_server_enabled": true,
  "oauth_server_allow_dynamic_registration": true,
  "oauth_server_authorization_path": "/oauth/consent"
}
```

Deploy `20260720160000_mogplex_mcp_oauth.sql`, then enable the custom access token hook:

```json
{
  "hook_custom_access_token_enabled": true,
  "hook_custom_access_token_uri": "pg-functions://postgres/public/custom_access_token_hook"
}
```

Do not enable the hook before the migration is live. When a signed-in user approves a dynamically registered client, Mogplex stores the deployment's resolved `MOGPLEX_MCP_RESOURCE_URL` with that client. The hook reads that value when assigning the token audience, so staging and local deployments mint tokens for their own advertised resource instead of the production URL. The API independently verifies the issuer, signature, expiry, audience, client allowlist entry, and linked Mogplex profile on every request.

## Verification

1. Read `/.well-known/oauth-protected-resource/api/v1/mogplex/mcp` and confirm the resource and Supabase authorization-server issuer.
2. Read the Supabase OAuth authorization-server discovery document and confirm authorization, token, and dynamic registration endpoints are present.
3. Add the server with `codex mcp add` and run `codex mcp login mogplex`.
4. Confirm an unapproved or wrong-audience token receives `401` with a `WWW-Authenticate` protected-resource metadata challenge.
5. After consent, list tools and run a read-only command before exercising a write tool.
