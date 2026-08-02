// RFC 8058 one-click unsubscribe.
//
// Gmail and Yahoo's 2024 bulk-sender rules require a `List-Unsubscribe`
// HTTPS endpoint that accepts a POST with body `List-Unsubscribe=One-Click`
// and immediately suppresses the recipient. This route is that endpoint.
// The identity is carried in the query string (?email=&t=) so we can
// verify the HMAC signature without parsing the body for identity.
//
// The route ALSO accepts GET. Some scanners and prefetchers (and the older
// mailto/`List-Unsubscribe`-style clients that haven't moved to one-click)
// hit GET first; we don't unsubscribe on GET — that would let any anti-virus
// preview opt the user out. GET redirects to the confirm page instead.

import { NextResponse } from "next/server";

import {
  recordUnsubscribe,
  verifyUnsubscribeToken,
} from "@/lib/email/unsubscribe";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dest = new URL("/unsubscribe", url.origin);
  dest.search = url.search;
  return NextResponse.redirect(dest, 303);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const email = url.searchParams.get("email");
  const token = url.searchParams.get("t");

  const verified = verifyUnsubscribeToken(email, token);
  if (!verified.ok) {
    // 400 is correct here — the inbox provider will not retry, which is
    // what we want: a bad signature means the link is forged or stale.
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const recorded = await recordUnsubscribe(verified.email, "one_click");
  if (!recorded.ok) {
    // 5xx so the provider retries — transient DB failures shouldn't drop
    // a real unsubscribe.
    return NextResponse.json({ error: "storage_error" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
