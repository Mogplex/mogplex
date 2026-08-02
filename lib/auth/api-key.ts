import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TOKEN_PREFIX = "mog_";
const TOKEN_RANDOM_BYTES = 24; // 24 bytes = 32 base62 chars
const BASE62_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// Rate limiting: max 60 requests per key per 60 seconds
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_MAX_KEYS = 10_000;

// Simple Map-based rate limit cache with manual eviction
const rateLimitCache = new Map<string, number[]>();
let lastCleanup = Date.now();

export interface ApiKeyAuth {
  userId: string;
  keyId: string;
  scopes: string[];
}

/**
 * Result of resolving a bearer token. Discriminated so callers that care
 * (notably the public v1 API) can map "rate limited" to 429 instead of
 * masquerading it as a 401 "bad token".
 */
export type ApiKeyResolution =
  | { ok: true; auth: ApiKeyAuth }
  | { ok: false; reason: "invalid" | "rate_limited" };

/** Window callers should advertise via Retry-After when reason is rate_limited. */
export const API_KEY_RATE_LIMIT_WINDOW_SECONDS = RATE_LIMIT_WINDOW_MS / 1000;

/**
 * Periodic cleanup of stale entries to prevent unbounded growth.
 * Runs at most once per minute.
 */
function cleanupRateLimitCache(): void {
  const now = Date.now();
  if (now - lastCleanup < RATE_LIMIT_WINDOW_MS) return;
  lastCleanup = now;

  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  for (const [key, timestamps] of rateLimitCache) {
    const valid = timestamps.filter((t) => t > windowStart);
    if (valid.length === 0) {
      rateLimitCache.delete(key);
    } else {
      rateLimitCache.set(key, valid);
    }
  }

  // Evict oldest entries if over max size
  if (rateLimitCache.size > RATE_LIMIT_MAX_KEYS) {
    const toDelete = rateLimitCache.size - RATE_LIMIT_MAX_KEYS;
    const keys = rateLimitCache.keys();
    for (let i = 0; i < toDelete; i++) {
      const next = keys.next();
      if (!next.done) rateLimitCache.delete(next.value);
    }
  }
}

/**
 * Check if a key has exceeded rate limits.
 * Returns true if rate limited.
 */
function isRateLimited(keyId: string): boolean {
  cleanupRateLimitCache();

  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  let timestamps = rateLimitCache.get(keyId) ?? [];
  timestamps = timestamps.filter((t) => t > windowStart);

  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  timestamps.push(now);
  rateLimitCache.set(keyId, timestamps);
  return false;
}

/**
 * Generate a new API token.
 * Returns both the plaintext token (to show user once) and its hash (to store).
 */
export function generateApiToken(): {
  token: string;
  hash: string;
  prefix: string;
} {
  const randomBuffer = randomBytes(TOKEN_RANDOM_BYTES);
  let randomPart = "";

  for (const byte of randomBuffer) {
    randomPart += BASE62_CHARS[byte % 62];
  }

  const token = `${TOKEN_PREFIX}${randomPart}`;
  const hash = createHash("sha256").update(token).digest("hex");
  const prefix = token.slice(0, 12);

  return { token, hash, prefix };
}

/**
 * Resolve a bearer token to a user.
 *
 * Returns an `ApiKeyResolution`:
 *   - `{ ok: true, auth }`            — valid, not rate-limited.
 *   - `{ ok: false, reason: "invalid" }`        — missing/malformed/unknown/expired/revoked.
 *   - `{ ok: false, reason: "rate_limited" }`  — valid token, over its per-key budget.
 *
 * Callers that surface HTTP status codes should map `rate_limited` to 429
 * (with a Retry-After header). Internal callers that only care about
 * "authenticated yes/no" can treat both `ok: false` cases the same.
 */
export async function resolveApiKey(
  authorization: string | null
): Promise<ApiKeyResolution> {
  if (!authorization?.startsWith(`Bearer ${TOKEN_PREFIX}`)) {
    return { ok: false, reason: "invalid" };
  }

  const token = authorization.slice(7); // strip "Bearer "
  const hash = createHash("sha256").update(token).digest("hex");

  const { data, error } = await supabaseAdmin
    .from("user_api_keys")
    .select("id, user_id, scopes, expires_at, revoked_at")
    .eq("token_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, reason: "invalid" };
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { ok: false, reason: "invalid" };
  }

  // Rate limit check — checked AFTER token validity so attackers spraying
  // bad tokens can't pollute the per-key budget of a real one.
  if (isRateLimited(data.id)) {
    return { ok: false, reason: "rate_limited" };
  }

  // Fire-and-forget: update last_used_at
  void supabaseAdmin
    .from("user_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    ok: true,
    auth: {
      userId: data.user_id,
      keyId: data.id,
      scopes: data.scopes,
    },
  };
}
