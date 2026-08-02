// Team invites are transactional, not marketing — we intentionally skip the
// unsubscribe-suppression gate and omit a List-Unsubscribe header. A teammate
// is reaching out personally; bulk-mail opt-outs should not silence that.

import { render } from "@react-email/components";
import { TeamInviteEmail } from "@/emails/team-invite";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

type SuccessChannel = "resend" | "log";
type SendResult =
  | { ok: true; channel: SuccessChannel }
  | { ok: false; reason: "resend_error" };

function appBaseUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://mogplex.com";
  return base.replace(/\/$/, "");
}

export function buildInviteAcceptUrl(token: string): string {
  return `${appBaseUrl()}/invite/${encodeURIComponent(token)}`;
}

export async function sendTeamInvite(params: {
  email: string;
  teamName: string;
  inviterName: string | null;
  role: "admin" | "developer" | "viewer";
  token: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.TEAM_INVITE_FROM_EMAIL ||
    process.env.WAITLIST_FROM_EMAIL ||
    "Mogplex <noreply@mogplex.com>";

  const acceptUrl = buildInviteAcceptUrl(params.token);

  if (!apiKey) {
    // Mirror the waitlist log-fallback so the flow works end-to-end without
    // Resend wired up; an operator can hand-deliver the accept link from logs.
    console.warn(
      JSON.stringify({
        event: "team_invite_pending_delivery",
        email: params.email,
        team: params.teamName,
        acceptUrl,
        note: "RESEND_API_KEY unset — hand-deliver acceptUrl to invitee",
      })
    );
    return { ok: true, channel: "log" };
  }

  const element = TeamInviteEmail({
    teamName: params.teamName,
    inviterName: params.inviterName,
    role: params.role,
    acceptUrl,
  });
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  const subject = `${params.inviterName || "A teammate"} invited you to ${
    params.teamName
  } on Mogplex`;

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.email],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      JSON.stringify({
        event: "team_invite_send_failed",
        status: response.status,
        detail: detail.slice(0, 500),
      })
    );
    return { ok: false, reason: "resend_error" };
  }

  return { ok: true, channel: "resend" };
}
