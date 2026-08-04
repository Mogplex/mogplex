import {
  findPlanPrice,
  findTopupPreset,
  TOPUP_MAX_CENTS,
  TOPUP_MIN_CENTS,
} from "@/lib/billing/catalog";

export type CheckoutRequest =
  | { kind: "subscribe"; plan: string; returnPath: string }
  | {
      kind: "topup";
      preset?: string;
      amountCents?: number;
      returnPath: string;
    };

export type CheckoutValidation =
  | { ok: true; request: CheckoutRequest }
  | { ok: false; error: string };

// Redirect targets must be same-app paths — never caller-supplied absolute
// URLs (open-redirect via Stripe's success_url otherwise).
const SAFE_RETURN_PATH = /^\/[\w\-./]*$/;

export function sanitizeReturnPath(value: unknown): string {
  if (
    typeof value === "string" &&
    value.length <= 200 &&
    !value.startsWith("//") &&
    SAFE_RETURN_PATH.test(value)
  ) {
    return value;
  }
  return "/";
}

export function validateCheckoutRequest(body: unknown): CheckoutValidation {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid request body" };
  }
  const { kind, returnPath: rawReturnPath } = body as {
    kind?: unknown;
    returnPath?: unknown;
  };
  const returnPath = sanitizeReturnPath(rawReturnPath);
  if (kind === "subscribe") {
    const { plan } = body as { plan?: unknown };
    if (typeof plan !== "string" || !findPlanPrice(plan)) {
      return { ok: false, error: "Unknown plan" };
    }
    return { ok: true, request: { kind: "subscribe", plan, returnPath } };
  }
  if (kind === "topup") {
    const { preset, amountCents } = body as {
      preset?: unknown;
      amountCents?: unknown;
    };
    if (typeof preset === "string") {
      if (!findTopupPreset(preset)) {
        return { ok: false, error: "Unknown top-up preset" };
      }
      return { ok: true, request: { kind: "topup", preset, returnPath } };
    }
    if (typeof amountCents !== "number" || !Number.isInteger(amountCents)) {
      return { ok: false, error: "Top-up amount must be integer cents" };
    }
    if (amountCents < TOPUP_MIN_CENTS) {
      return {
        ok: false,
        error: `Minimum top-up is $${(TOPUP_MIN_CENTS / 100).toFixed(2)}`,
      };
    }
    if (amountCents > TOPUP_MAX_CENTS) {
      // Fraud guardrail, not a usage limit — raised on request instantly
      // (pricing-plan 02 §3b).
      return {
        ok: false,
        error: `Top-ups above $${TOPUP_MAX_CENTS / 100} require a support request`,
      };
    }
    return { ok: true, request: { kind: "topup", amountCents, returnPath } };
  }
  return { ok: false, error: "Unknown checkout kind" };
}
