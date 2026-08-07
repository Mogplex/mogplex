// Per-client refresh-token lifetime for the Better Auth OAuth provider.
//
// The `mcp` plugin has a single global `refreshTokenExpiresIn`, which we set
// to effectively-never so hosted MCP clients (claude.ai, Cursor, …) are not
// forced to re-authenticate. The mogplex CLI should not hold eternal
// credentials on disk, so this hook clamps its refresh tokens to 30 days
// after every /mcp/token issuance (both the code exchange and the rotating
// refresh grant go through that endpoint).
//
// The clamp is a conditional update — `refreshTokenExpiresAt > cap` — so it
// only ever shortens a token's life at issuance and never extends one.

import { createAuthMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";

export const MOGPLEX_CLI_OAUTH_CLIENT_ID = "mogplex-cli";

export const CLI_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * Refresh tokens rotate on use, so "30 days" means 30 days of inactivity —
 * an actively used CLI stays signed in indefinitely.
 */
export const cliTokenTtl = (): BetterAuthPlugin => ({
  id: "cli-token-ttl",
  hooks: {
    after: [
      {
        matcher: (ctx) => ctx.path === "/mcp/token",
        handler: createAuthMiddleware(async (ctx) => {
          const clientId = (ctx.body as { client_id?: unknown } | undefined)
            ?.client_id;
          if (clientId !== MOGPLEX_CLI_OAUTH_CLIENT_ID) return;

          const cap = new Date(
            Date.now() + CLI_REFRESH_TOKEN_TTL_SECONDS * 1000
          );
          await ctx.context.adapter.updateMany({
            model: "oauthAccessToken",
            where: [
              { field: "clientId", value: MOGPLEX_CLI_OAUTH_CLIENT_ID },
              { field: "refreshTokenExpiresAt", value: cap, operator: "gt" },
            ],
            update: { refreshTokenExpiresAt: cap },
          });
        }),
      },
    ],
  },
});
