// In-process IP-based rate limit for unauthenticated public POST endpoints
// (e.g. the waitlist request and validate routes). Each serverless instance
// keeps its own counters — this is a basic abuse mitigation, not a strict
// global cap. Promote to Vercel KV / Upstash when traffic warrants it.

type Bucket = {
  count: number;
  resetAt: number;
};

type LimitConfig = {
  // Per-key sliding window — the count resets when `now > resetAt`.
  windowMs: number;
  // Maximum requests allowed inside the window before we start denying.
  max: number;
};

const buckets = new Map<string, Bucket>();

// Best-effort prevention of unbounded memory growth on a hot instance. The
// map is per-process so this only matters under sustained abuse, but cheap.
const MAX_TRACKED_KEYS = 10_000;

function pruneIfFull(now: number) {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size < MAX_TRACKED_KEYS) return;
  // Still full — drop the oldest half by reset time.
  const sorted = [...buckets.entries()].sort(
    (a, b) => a[1].resetAt - b[1].resetAt
  );
  for (let i = 0; i < Math.floor(sorted.length / 2); i++) {
    buckets.delete(sorted[i][0]);
  }
}

export type RateLimitDecision =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; retryAfterSeconds: number; resetAt: number };

export function consumePublicRateLimit(
  key: string,
  config: LimitConfig
): RateLimitDecision {
  const now = Date.now();
  pruneIfFull(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const fresh: Bucket = { count: 1, resetAt: now + config.windowMs };
    buckets.set(key, fresh);
    return { allowed: true, remaining: config.max - 1, resetAt: fresh.resetAt };
  }

  if (bucket.count >= config.max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      resetAt: bucket.resetAt,
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: config.max - bucket.count,
    resetAt: bucket.resetAt,
  };
}

// Extract a best-effort client IP. We trust ONLY the platform-set
// `x-forwarded-for` left-most entry — on Vercel that's the connecting
// client and the only header an attacker cannot forge. Headers like
// `x-real-ip` and `cf-connecting-ip` are arbitrary request headers when
// no matching proxy is in front of the app, so rotating them would hand
// out a fresh bucket per request. All other traffic falls into a shared
// "unknown" bucket so we still apply a cap.
export function getPublicRateLimitKey(
  request: Request,
  prefix: string
): string {
  const xff = request.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  if (first) return `${prefix}:${first}`;
  return `${prefix}:unknown`;
}

// Reset for tests.
export function __resetPublicRateLimitsForTests() {
  buckets.clear();
}
