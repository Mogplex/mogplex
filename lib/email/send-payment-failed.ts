// Failed-payment notice for a subscription invoice. Billing email is
// transactional, not marketing — no unsubscribe-suppression gate and no
// List-Unsubscribe header, same reasoning as auth emails and team invites.

import { render } from "@react-email/components";
import { PaymentFailedEmail } from "@/emails/payment-failed";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

type SuccessChannel = "resend" | "log";
export type PaymentFailedSendResult =
  | { ok: true; channel: SuccessChannel }
  | { ok: false; reason: "resend_error" | "not_configured" };

export type PaymentFailedEmailParams = {
  email: string;
  amountCents: number;
  currency: string;
  nextAttemptAt: Date | null;
  payUrl: string;
  /** Resend dedupes sends with the same key for 24h, so webhook replays do not double-send. */
  idempotencyKey: string;
};

/** Formats minor units for display, e.g. 2000 + "usd" → "$20.00". */
export function formatInvoiceAmount(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

function formatAttemptDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

/** Sends the failed-payment notice through Resend; fails closed in production without a key. */
export async function sendPaymentFailedEmail(
  params: PaymentFailedEmailParams
): Promise<PaymentFailedSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.BILLING_FROM_EMAIL ||
    process.env.WAITLIST_FROM_EMAIL ||
    "Mogplex <noreply@mogplex.com>";

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      // A silent log fallback is how this notice went missing before: in
      // production a missing key is a delivery failure the caller retries.
      console.error(
        JSON.stringify({
          event: "payment_failed_email_not_configured",
          note: "RESEND_API_KEY unset in production — billing email delivery disabled",
        })
      );
      return { ok: false, reason: "not_configured" };
    }
    console.warn(
      JSON.stringify({
        event: "payment_failed_email_pending_delivery",
        email: params.email,
        payUrl: params.payUrl,
        note: "RESEND_API_KEY unset — failed-payment notice not delivered",
      })
    );
    return { ok: true, channel: "log" };
  }

  const amount = formatInvoiceAmount(params.amountCents, params.currency);
  const element = PaymentFailedEmail({
    amount,
    nextAttempt: params.nextAttemptAt
      ? formatAttemptDate(params.nextAttemptAt)
      : null,
    payUrl: params.payUrl,
  });
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": params.idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: [params.email],
      subject: `Action needed: your Mogplex payment of ${amount} failed`,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      JSON.stringify({
        event: "payment_failed_email_send_failed",
        status: response.status,
        detail: detail.slice(0, 500),
      })
    );
    return { ok: false, reason: "resend_error" };
  }

  return { ok: true, channel: "resend" };
}
