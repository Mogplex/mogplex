import { NextResponse } from "next/server";
import {
  normalizeWaitlistRequest,
  recordWaitlistRequest,
} from "@/lib/waitlist-request";
import {
  consumePublicRateLimit,
  getPublicRateLimitKey,
} from "@/lib/public-ip-rate-limit";

type RequestResponse =
  | { ok: true; alreadyRequested: boolean }
  | {
      ok: false;
      error:
        | "invalid_request"
        | "invalid_email"
        | "invalid_field"
        | "rate_limited"
        | "server";
    };

// Burst of 5 submissions / 60s per IP. Approved teams hit this once; abusers
// or scripts get a 429 fast. Per-serverless-instance cap — effective global
// ceiling is `max * active_instances`, which is why 5 looks low. Tighten or
// promote to a shared store (Vercel KV / Upstash) once traffic warrants it.
const RATE_LIMIT = { windowMs: 60_000, max: 5 } as const;

export async function POST(request: Request) {
  const rate = consumePublicRateLimit(
    getPublicRateLimitKey(request, "waitlist_request"),
    RATE_LIMIT
  );
  if (!rate.allowed) {
    return NextResponse.json<RequestResponse>(
      { ok: false, error: "rate_limited" },
      {
        status: 429,
        headers: { "retry-after": String(rate.retryAfterSeconds) },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<RequestResponse>(
      { ok: false, error: "invalid_request" },
      { status: 400 }
    );
  }

  const normalized = normalizeWaitlistRequest(body);
  if ("error" in normalized) {
    return NextResponse.json<RequestResponse>(
      { ok: false, error: normalized.error },
      { status: 400 }
    );
  }

  const result = await recordWaitlistRequest(normalized);
  if (!result.ok) {
    return NextResponse.json<RequestResponse>(
      { ok: false, error: "server" },
      { status: 500 }
    );
  }

  return NextResponse.json<RequestResponse>({
    ok: true,
    alreadyRequested: result.alreadyRequested,
  });
}
