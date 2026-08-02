// Better-auth transactional email (verification, password reset). These are
// account-action emails, not marketing — no unsubscribe-suppression gate and
// no List-Unsubscribe header, same reasoning as team invites.

import { render } from "@react-email/components";
import { AuthActionEmail } from "@/emails/auth-action";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

type SuccessChannel = "resend" | "log";
type SendResult =
  | { ok: true; channel: SuccessChannel }
  | { ok: false; reason: "resend_error" | "not_configured" };

// Verification/reset URLs carry single-use bearer tokens — never log the
// query string in production.
function redactActionUrl(actionUrl: string): string {
  try {
    const url = new URL(actionUrl);
    return `${url.origin}${url.pathname}${url.search ? "?[redacted]" : ""}`;
  } catch {
    return "[unparseable-url-redacted]";
  }
}

export type AuthActionKind = "verify-email" | "reset-password";

const COPY: Record<
  AuthActionKind,
  {
    subject: string;
    heading: string;
    body: string;
    buttonLabel: string;
    footnote: string;
  }
> = {
  "verify-email": {
    subject: "Verify your email for Mogplex",
    heading: "Verify your email",
    body: "Confirm your email address to finish setting up your Mogplex account.",
    buttonLabel: "Verify email",
    footnote:
      "This link expires in 1 hour. If you didn't create a Mogplex account, you can safely ignore this email.",
  },
  "reset-password": {
    subject: "Reset your Mogplex password",
    heading: "Reset your password",
    body: "We received a request to reset the password for your Mogplex account. Click below to choose a new one.",
    buttonLabel: "Reset password",
    footnote:
      "This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email — your password is unchanged.",
  },
};

export async function sendAuthActionEmail(params: {
  kind: AuthActionKind;
  email: string;
  actionUrl: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.AUTH_FROM_EMAIL ||
    process.env.WAITLIST_FROM_EMAIL ||
    "Mogplex <noreply@mogplex.com>";
  const copy = COPY[params.kind];

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      // Unlike the waitlist/invite senders, auth links are credentials.
      // In production a missing key fails closed: no token in the logs and
      // the caller surfaces the failure instead of returning success.
      console.error(
        JSON.stringify({
          event: "auth_action_email_not_configured",
          kind: params.kind,
          email: params.email,
          actionUrl: redactActionUrl(params.actionUrl),
          note: "RESEND_API_KEY unset in production — auth email delivery disabled",
        })
      );
      return { ok: false, reason: "not_configured" };
    }
    // Dev/test log-fallback, same spirit as the waitlist and invite senders:
    // the flow stays usable without Resend wired up.
    console.warn(
      JSON.stringify({
        event: "auth_action_email_pending_delivery",
        kind: params.kind,
        email: params.email,
        actionUrl: params.actionUrl,
        note: "RESEND_API_KEY unset — hand-deliver actionUrl to the user",
      })
    );
    return { ok: true, channel: "log" };
  }

  const element = AuthActionEmail({
    heading: copy.heading,
    body: copy.body,
    buttonLabel: copy.buttonLabel,
    actionUrl: params.actionUrl,
    footnote: copy.footnote,
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
      to: [params.email],
      subject: copy.subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      JSON.stringify({
        event: "auth_action_email_send_failed",
        kind: params.kind,
        status: response.status,
        detail: detail.slice(0, 500),
      })
    );
    return { ok: false, reason: "resend_error" };
  }

  return { ok: true, channel: "resend" };
}
