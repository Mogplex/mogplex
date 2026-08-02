/**
 * Scope model for the public v1 API.
 *
 * Today two scopes exist:
 *   - `read`  — list/get endpoints (GET /repos, GET /sandboxes, GET /runs)
 *   - `write` — mutating endpoints (POST /runs, POST cancel, and future
 *               sandbox lifecycle POSTs)
 *
 * Tokens issued before scope enforcement landed are backfilled to
 * `['read', 'write']` via the supabase migration so existing automation
 * does not break. New tokens default to `['read', 'write']` until the
 * settings UI exposes the choice.
 *
 * Route handlers call `requireScope(user, 'write')` after `resolveMogplexApiUser`
 * and return its NextResponse when present. Returning the response (vs.
 * throwing) keeps the route handler shape consistent with the auth check.
 */

import { mogplexApiError } from "./response";
import type { NextResponse } from "next/server";
import type { ApiKeyAuth } from "@/lib/auth/api-key";
import type { MogplexApiErrorBody } from "./response";

export const MOGPLEX_API_SCOPES = ["read", "write"] as const;
export type MogplexApiScope = (typeof MOGPLEX_API_SCOPES)[number];

/**
 * Type guard. Useful when validating PAT-creation input.
 */
export function isMogplexApiScope(value: unknown): value is MogplexApiScope {
  return (
    typeof value === "string" &&
    (MOGPLEX_API_SCOPES as readonly string[]).includes(value)
  );
}

/**
 * Returns null when the user has the required scope, otherwise a 403
 * NextResponse the caller can return directly.
 *
 * ```ts
 * const user = await resolveMogplexApiUser(request);
 * if (!user.ok) return user.response;
 * const forbidden = requireScope(user, "write");
 * if (forbidden) return forbidden;
 * ```
 */
export function requireScope(
  user: Pick<ApiKeyAuth, "scopes">,
  required: MogplexApiScope
): NextResponse<MogplexApiErrorBody> | null {
  if (user.scopes.includes(required)) return null;
  return mogplexApiError(
    "FORBIDDEN",
    `Missing required scope: ${required}. Issue a new token with the '${required}' scope at /settings/api-keys.`,
    403
  );
}
