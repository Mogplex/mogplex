import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const WAITLIST_COOKIE_NAME = "mogplex_waitlist_ok";
export const WAITLIST_COOKIE_MAX_AGE_SECONDS = 30 * 60;
export const WAITLIST_CODE_MAX_LENGTH = 128;

type RedeemReason = "invalid" | "expired" | "exhausted";

export type RedeemResult = { ok: true } | { ok: false; reason: RedeemReason };

// HMAC secret: prefer a dedicated env, fall back to the service role key
// (already a server-only secret). This signature only needs to be unforgeable
// from the browser; high-security key separation is not required.
function getSigningSecret(): string {
  const secret =
    process.env.WAITLIST_COOKIE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "WAITLIST_COOKIE_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set for waitlist signing"
    );
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSigningSecret()).update(payload).digest("hex");
}

export function normalizeWaitlistCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > WAITLIST_CODE_MAX_LENGTH) {
    return null;
  }
  // Codes are operator-issued ASCII; reject anything weird before round-tripping
  // through a cookie value.
  if (!/^[!-~]+$/.test(trimmed)) return null;
  return trimmed;
}

export function buildWaitlistCookieValue(code: string): string {
  const expiresAt =
    Math.floor(Date.now() / 1000) + WAITLIST_COOKIE_MAX_AGE_SECONDS;
  const payload = `${code}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyWaitlistCookieValue(
  raw: string | undefined | null
): boolean {
  if (!raw) return false;
  // Split from the right so the code itself may contain dots if ever needed
  // in the future. Current normalization forbids them, but the format stays
  // forward-compatible.
  const lastDot = raw.lastIndexOf(".");
  if (lastDot <= 0) return false;
  const payload = raw.slice(0, lastDot);
  const signature = raw.slice(lastDot + 1);

  const expected = sign(payload);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  if (!timingSafeEqual(a, b)) return false;

  const expiresAt = Number(payload.slice(payload.lastIndexOf(".") + 1));
  if (!Number.isFinite(expiresAt)) return false;
  return Math.floor(Date.now() / 1000) < expiresAt;
}

export async function redeemWaitlistCode(code: string): Promise<RedeemResult> {
  const { data, error } = await supabaseAdmin.rpc("redeem_waitlist_code", {
    p_code: code,
  });
  if (error) {
    throw new Error(`redeem_waitlist_code rpc failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.ok === true) return { ok: true };
  const reason = (row?.reason as RedeemReason | undefined) ?? "invalid";
  return { ok: false, reason };
}
