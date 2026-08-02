import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendWaitlistReplacementCode } from "@/lib/email/send-waitlist-replacement-code";

export const WAITLIST_REPLACEMENT_EMAIL_MAX = 320;

// Matches the public-signup validator in lib/waitlist-request.ts. Permissive
// enough for real addresses, strict enough to reject obvious junk.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ReplacementInput = { email: string };

export type ReplacementResult =
  | { ok: true }
  | { ok: false; reason: "invalid_email" | "storage_error" };

export function normalizeReplacementInput(
  input: unknown
): ReplacementInput | { error: "invalid_email" } {
  if (!input || typeof input !== "object") return { error: "invalid_email" };
  const raw = (input as { email?: unknown }).email;
  if (typeof raw !== "string") return { error: "invalid_email" };
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > WAITLIST_REPLACEMENT_EMAIL_MAX) {
    return { error: "invalid_email" };
  }
  if (!EMAIL_RE.test(trimmed)) return { error: "invalid_email" };
  return { email: trimmed.toLowerCase() };
}

export async function issueReplacementCode(
  input: ReplacementInput
): Promise<ReplacementResult> {
  // The RPC handles "does this email map to an auth user" + minting in one
  // round trip. It returns the new code, or NULL when no matching user
  // exists. The caller always returns generic success so the response
  // doesn't leak whether the email is registered.
  const { data, error } = await supabaseAdmin.rpc(
    "mint_waitlist_replacement_code",
    { p_email: input.email }
  );

  if (error) {
    return { ok: false, reason: "storage_error" };
  }

  const code = typeof data === "string" ? data : null;
  if (!code) {
    return { ok: true };
  }

  const send = await sendWaitlistReplacementCode(input.email, code);
  if (!send.ok) {
    // Two-layer expiry strategy:
    //   1. `mint_waitlist_replacement_code` (the RPC) already expires any
    //      prior live codes for the same email before each new mint, so a
    //      caller that retries through the normal path is safe by default.
    //   2. This client-side expire is defense-in-depth for callers that do
    //      not retry through the RPC (admin tooling, alternate routes), and
    //      shrinks the window in which a leaked-but-undelivered code could
    //      be redeemed. We write the unix epoch instead of the current
    //      client clock so the value is unconditionally in the past — the
    //      redemption check (`WHERE expires_at > NOW()` on the DB clock) is
    //      then immune to any client/DB clock skew, including the case
    //      where the client clock is ahead of the DB clock.
    // Errors here are logged but not propagated — the caller already knows
    // the send failed.
    const { error: expireError } = await supabaseAdmin
      .from("waitlist_codes")
      .update({ expires_at: new Date(0).toISOString() })
      .eq("code", code);
    if (expireError) {
      console.error(
        JSON.stringify({
          event: "waitlist_replacement_code_expire_failed",
          code_prefix: code.slice(0, 4),
          message: expireError.message,
        })
      );
    }
    return { ok: false, reason: "storage_error" };
  }

  return { ok: true };
}
