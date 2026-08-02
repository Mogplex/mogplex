import type { Metadata } from "next";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PRIVATE_NO_INDEX_ROBOTS } from "@/lib/seo";
import { InviteAcceptForm } from "./invite-accept-form";

export const metadata: Metadata = {
  title: "Team invitation — Mogplex",
  robots: PRIVATE_NO_INDEX_ROBOTS,
};

type Invite = {
  id: string;
  team_id: string;
  email: string;
  role: "admin" | "developer" | "viewer";
  expires_at: string;
  accepted_at: string | null;
  invited_by_user_id: string | null;
};

async function loadInvite(token: string): Promise<Invite | null> {
  const { data } = await supabaseAdmin
    .from("team_invites")
    .select(
      "id, team_id, email, role, expires_at, accepted_at, invited_by_user_id"
    )
    .eq("token", token)
    .maybeSingle();
  return (data as Invite | null) ?? null;
}

function isInviteExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}

async function loadCurrentEmail(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const authUserId = data.user?.id;
  if (!authUserId) return null;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return (profile?.email as string | null) ?? null;
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-sm">
        {children}
      </div>
    </main>
  );
}

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await loadInvite(token);

  if (!invite) {
    return (
      <InviteShell>
        <h1 className="text-xl font-medium text-foreground">
          Invitation not found
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This invitation link is invalid. Ask whoever sent it to send a fresh
          one.
        </p>
        <div className="mt-6">
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Home
          </Link>
        </div>
      </InviteShell>
    );
  }

  const { data: team } = await supabaseAdmin
    .from("teams")
    .select("name, slug")
    .eq("id", invite.team_id)
    .single();

  const teamName = (team?.name as string | null) || "the team";

  const { data: inviter } = invite.invited_by_user_id
    ? await supabaseAdmin
        .from("profiles")
        .select("name, username")
        .eq("id", invite.invited_by_user_id)
        .maybeSingle()
    : { data: null };

  const inviterName =
    (inviter?.name as string | null) ||
    (inviter?.username as string | null) ||
    null;

  const expired = isInviteExpired(invite.expires_at);
  const alreadyAccepted = Boolean(invite.accepted_at);

  if (expired || alreadyAccepted) {
    return (
      <InviteShell>
        <h1 className="text-xl font-medium text-foreground">
          {alreadyAccepted ? "Invitation already accepted" : "Invitation expired"}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {alreadyAccepted
            ? `This invitation to ${teamName} has already been used.`
            : `This invitation to ${teamName} expired on ${new Date(
                invite.expires_at
              ).toLocaleDateString()}. Ask an admin to send a fresh one.`}
        </p>
        <div className="mt-6">
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Home
          </Link>
        </div>
      </InviteShell>
    );
  }

  const currentEmail = await loadCurrentEmail();
  const inviteEmail = invite.email.toLowerCase();
  const loggedIn = currentEmail !== null;
  const emailMatch =
    loggedIn && currentEmail!.toLowerCase() === inviteEmail;

  return (
    <InviteShell>
      <h1 className="text-xl font-medium text-foreground">
        Join {teamName} on Mogplex
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {inviterName ? `${inviterName} invited you ` : "You were invited "}to
        join <strong className="text-foreground">{teamName}</strong> as a{" "}
        <strong className="text-foreground">{invite.role}</strong>.
      </p>
      <div className="mt-5 rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground">
        Invitation sent to{" "}
        <span className="text-foreground">{inviteEmail}</span>
      </div>

      {!loggedIn ? (
        <div className="mt-6 space-y-3">
          { }
          <a
            href={`/api/auth/login/github?next=${encodeURIComponent(
              `/invite/${token}`
            )}`}
            className="block w-full rounded-md bg-foreground px-3 py-2 text-center text-sm font-medium text-background hover:bg-foreground/90"
          >
            Continue with GitHub
          </a>
          <p className="text-center text-xs text-muted-foreground">
            Sign in to accept this invitation.
          </p>
        </div>
      ) : (
        <InviteAcceptForm
          token={token}
          emailMatch={emailMatch}
          inviteEmail={inviteEmail}
          currentEmail={currentEmail!}
        />
      )}
    </InviteShell>
  );
}
