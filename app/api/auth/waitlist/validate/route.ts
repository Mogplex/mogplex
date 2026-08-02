import { NextResponse } from "next/server";
import {
  WAITLIST_COOKIE_MAX_AGE_SECONDS,
  WAITLIST_COOKIE_NAME,
  buildWaitlistCookieValue,
  normalizeWaitlistCode,
  redeemWaitlistCode,
} from "@/lib/waitlist";

type ValidateResponse =
  | { ok: true }
  | {
      ok: false;
      error: "invalid_request" | "invalid" | "expired" | "exhausted";
    };

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ValidateResponse>(
      { ok: false, error: "invalid_request" },
      { status: 400 }
    );
  }

  const code = normalizeWaitlistCode((body as { code?: unknown } | null)?.code);
  if (!code) {
    return NextResponse.json<ValidateResponse>(
      { ok: false, error: "invalid_request" },
      { status: 400 }
    );
  }

  const result = await redeemWaitlistCode(code);
  if (!result.ok) {
    return NextResponse.json<ValidateResponse>(
      { ok: false, error: result.reason },
      { status: 400 }
    );
  }

  const response = NextResponse.json<ValidateResponse>({ ok: true });
  response.cookies.set({
    name: WAITLIST_COOKIE_NAME,
    value: buildWaitlistCookieValue(code),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WAITLIST_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
