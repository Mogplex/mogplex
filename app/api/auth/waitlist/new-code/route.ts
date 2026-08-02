import { NextResponse } from "next/server";
import {
  consumePublicRateLimit,
  getPublicRateLimitKey,
} from "@/lib/public-ip-rate-limit";
import {
  issueReplacementCode,
  normalizeReplacementInput,
} from "@/lib/waitlist-replacement";

type NewCodeResponse =
  | { ok: true }
  | {
      ok: false;
      error: "invalid_request" | "invalid_email" | "rate_limited" | "server";
    };

// Tighter than the /request POST: replacement requests should be rare per IP
// and an attacker enumerating addresses is the main abuse vector. Per-instance
// cap — effective global ceiling is `max * active_instances`.
const RATE_LIMIT = { windowMs: 60_000, max: 3 } as const;

export async function POST(request: Request) {
  const rate = consumePublicRateLimit(
    getPublicRateLimitKey(request, "waitlist_new_code"),
    RATE_LIMIT
  );
  if (!rate.allowed) {
    return NextResponse.json<NewCodeResponse>(
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
    return NextResponse.json<NewCodeResponse>(
      { ok: false, error: "invalid_request" },
      { status: 400 }
    );
  }

  const normalized = normalizeReplacementInput(body);
  if ("error" in normalized) {
    return NextResponse.json<NewCodeResponse>(
      { ok: false, error: normalized.error },
      { status: 400 }
    );
  }

  const result = await issueReplacementCode(normalized);
  if (!result.ok) {
    return NextResponse.json<NewCodeResponse>(
      { ok: false, error: "server" },
      { status: 500 }
    );
  }

  // Always 200 on a valid email — the route never reveals whether the address
  // is registered. UI shows a "check your inbox" message either way.
  return NextResponse.json<NewCodeResponse>({ ok: true });
}
