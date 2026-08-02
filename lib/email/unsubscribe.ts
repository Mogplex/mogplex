// Unsubscribe token + DB helpers.
//
// Tokens are stateless HMAC-SHA256 signatures of the lowercased email,
// using EMAIL_UNSUBSCRIBE_SECRET. The link itself carries the email +
// signature in the query string — no per-email row needs to be created at
// send time, and the link is valid until the secret rotates.
//
// Tradeoffs vs. UUID-in-DB tokens:
//   - Stateless: no extra write on each send (one less failure mode).
//   - No expiry: that's intentional. Inbox providers may re-fetch the link
//     weeks after delivery (warm-up, indexing); a UUID-with-TTL would break
//     those late clicks. Rotate EMAIL_UNSUBSCRIBE_SECRET to invalidate all
//     outstanding links at once.
//   - No per-link audit: we still record the email + timestamp + source
//     in `email_unsubscribes`, which is the audit trail recipients and
//     regulators actually care about.

import { createHmac, timingSafeEqual } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/admin";

// Read the secret per-call rather than capturing at module load. If this
// module is evaluated during the Next.js build step (a 'use server' import
// graph, a statically pre-rendered page, etc.) a module-level capture would
// freeze whatever value `process.env.EMAIL_UNSUBSCRIBE_SECRET` had at build
// time — typically undefined in build runners — and silently fall back to
// the dev placeholder. Every link minted that way would then fail to
// verify in production. Reading per-call costs nothing measurable and
// eliminates the build-time capture risk entirely.
function getSecret(): string {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "EMAIL_UNSUBSCRIBE_SECRET is unset or too short in production"
    );
  }
  // Local dev fallback. Clearly marked so a leaked link is obviously dev.
  return "dev-only-unsubscribe-secret-replace-me";
}

function sign(email: string): string {
  return createHmac("sha256", getSecret())
    .update(email.toLowerCase())
    .digest("hex");
}

export type UnsubscribeToken = {
  email: string;
  signature: string;
};

export function mintUnsubscribeToken(email: string): UnsubscribeToken {
  const normalized = email.trim().toLowerCase();
  return { email: normalized, signature: sign(normalized) };
}

export function verifyUnsubscribeToken(
  email: unknown,
  signature: unknown
): { ok: true; email: string } | { ok: false } {
  if (typeof email !== "string" || typeof signature !== "string") {
    return { ok: false };
  }
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 320) return { ok: false };
  const expected = sign(normalized);
  // timingSafeEqual requires equal-length buffers.
  if (expected.length !== signature.length) return { ok: false };
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (!timingSafeEqual(a, b)) return { ok: false };
  return { ok: true, email: normalized };
}

function siteOrigin(): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://mogplex.com";
  return base.replace(/\/$/, "");
}

export function unsubscribeUrl(email: string): string {
  const { email: e, signature } = mintUnsubscribeToken(email);
  const params = new URLSearchParams({ email: e, t: signature });
  return `${siteOrigin()}/unsubscribe?${params.toString()}`;
}

export function oneClickUnsubscribePostUrl(email: string): string {
  // RFC 8058 one-click: List-Unsubscribe-Post target. Must be HTTPS and
  // accept a POST with body `List-Unsubscribe=One-Click`. The email +
  // signature go in the query string so the endpoint can verify without
  // parsing form bodies for identity.
  const { email: e, signature } = mintUnsubscribeToken(email);
  const params = new URLSearchParams({ email: e, t: signature });
  return `${siteOrigin()}/api/unsubscribe?${params.toString()}`;
}

export type UnsubscribeSource = "landing_page" | "one_click";

export async function isUnsubscribed(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabaseAdmin
    .from("email_unsubscribes")
    .select("email")
    .eq("email", normalized)
    .maybeSingle();
  if (error) {
    // Fail closed: if we can't tell, treat as unsubscribed. Losing one
    // legitimate send is cheaper than mailing someone who opted out.
    console.error(
      JSON.stringify({
        event: "email_unsubscribe_check_failed",
        message: error.message,
      })
    );
    return true;
  }
  return data !== null;
}

export async function recordUnsubscribe(
  email: string,
  source: UnsubscribeSource
): Promise<{ ok: true } | { ok: false; reason: "storage_error" }> {
  const normalized = email.trim().toLowerCase();
  // Upsert so repeat clicks are idempotent (Gmail, Outlook, and the user
  // themselves may all hit the endpoint for the same address).
  const { error } = await supabaseAdmin
    .from("email_unsubscribes")
    .upsert({ email: normalized, source }, { onConflict: "email" });
  if (error) {
    console.error(
      JSON.stringify({
        event: "email_unsubscribe_record_failed",
        source,
        message: error.message,
      })
    );
    return { ok: false, reason: "storage_error" };
  }
  return { ok: true };
}
