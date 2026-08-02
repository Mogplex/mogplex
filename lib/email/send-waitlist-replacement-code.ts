// Email a single-use replacement waitlist code to an existing user. Uses
// Resend when RESEND_API_KEY is set; falls back to a structured server-log
// line so the flow works end-to-end (you copy the code from Vercel logs and
// hand-deliver it) until Resend is wired up.

import { render } from "@react-email/components";

import { WaitlistReplacementCodeEmail } from "@/emails/waitlist-replacement-code";
import {
  isUnsubscribed,
  oneClickUnsubscribePostUrl,
  unsubscribeUrl as buildUnsubscribeUrl,
} from "@/lib/email/unsubscribe";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

type SendResult =
  | { ok: true; channel: "resend" | "log" | "suppressed" }
  | { ok: false; reason: "resend_error" };

function loginUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://mogplex.com";
  return `${base.replace(/\/$/, "")}/login`;
}

export async function sendWaitlistReplacementCode(
  email: string,
  code: string
): Promise<SendResult> {
  // Suppression check first — applies to every send path (Resend AND the
  // log fallback). Honor unsubscribes even in dev so the suppression list
  // is the single source of truth.
  if (await isUnsubscribed(email)) {
    console.warn(
      JSON.stringify({
        event: "waitlist_replacement_code_suppressed",
        email,
        note: "Recipient is on email_unsubscribes. Code was minted but not delivered. Caller should surface a generic success to avoid leaking subscription state.",
      })
    );
    return { ok: true, channel: "suppressed" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.WAITLIST_FROM_EMAIL || "Mogplex <noreply@mogplex.com>";

  if (!apiKey) {
    // The code itself is a live single-use credential, so we never log it —
    // Vercel stderr is visible to anyone on the team with log access. We
    // emit the recipient + a pointer, and an operator pulls the code from
    // the waitlist_codes table directly.
    console.warn(
      JSON.stringify({
        event: "waitlist_replacement_code_pending_delivery",
        email,
        note: "RESEND_API_KEY unset — retrieve code from public.waitlist_codes (note ILIKE 'replacement for ' || email) and hand-deliver",
      })
    );
    return { ok: true, channel: "log" };
  }

  const url = loginUrl();
  const unsubscribeUrl = buildUnsubscribeUrl(email);
  const oneClickUrl = oneClickUnsubscribePostUrl(email);
  const element = WaitlistReplacementCodeEmail({
    code,
    loginUrl: url,
    unsubscribeUrl,
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
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your new Mogplex access code",
      html,
      text,
      // RFC 8058 one-click unsubscribe headers. Gmail and Yahoo's 2024 bulk
      // sender rules require these on any list-style mail; we set them on
      // transactional too because the unsubscribe is genuinely global and
      // the headers make the user's mail client honor it consistently.
      //
      // We only put the HTTPS one-click URL in `List-Unsubscribe`. Gmail's
      // spec is `<mailto:>, <https://>` (mailto first, HTTPS last) when
      // both are present; we don't run a mailto inbox for unsubscribes,
      // so HTTPS-only is the unambiguous form. The human-facing landing
      // page is reachable from the email footer link instead.
      headers: {
        "List-Unsubscribe": `<${oneClickUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      JSON.stringify({
        event: "waitlist_replacement_code_send_failed",
        status: response.status,
        detail: detail.slice(0, 500),
      })
    );
    return { ok: false, reason: "resend_error" };
  }

  return { ok: true, channel: "resend" };
}
