import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateInviteToken } from "@/lib/invite-token";
import { sendTeamInvite } from "@/lib/email/send-team-invite";
import { canInviteRole, loadTeamMembershipAuth } from "@/lib/team-management";
import { recordTeamAuditEvent } from "@/lib/team-audit";
import {
  BULK_INVITE_SEND_CONCURRENCY,
  MAX_BULK_INVITE_EMAILS,
  chunkEmails,
  prepareBulkInviteEmails,
  summarizeBulkInviteResults,
  type BulkInviteResult,
  type BulkInviteRole,
} from "@/lib/team-bulk-invite";

export type {
  BulkInviteResponse,
  BulkInviteResult,
  BulkInviteRole,
} from "@/lib/team-bulk-invite";

const INVITE_ROLES = new Set<BulkInviteRole>(["admin", "developer", "viewer"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ teamId: string }> }
) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const { teamId } = await context.params;

  // Authorize before parsing/validating the payload so unauthenticated callers
  // can't use validation responses to probe team existence.
  const auth = await loadTeamMembershipAuth(teamId, profileId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { emails?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const role = typeof body.role === "string" ? body.role : "";
  if (!INVITE_ROLES.has(role as BulkInviteRole)) {
    return NextResponse.json(
      { error: "role must be admin, developer, or viewer" },
      { status: 422 }
    );
  }
  if (!canInviteRole(auth.role, role as BulkInviteRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!Array.isArray(body.emails)) {
    return NextResponse.json(
      { error: "emails must be an array of strings" },
      { status: 422 }
    );
  }
  if (body.emails.length === 0) {
    return NextResponse.json(
      { error: "emails must not be empty" },
      { status: 422 }
    );
  }
  if (body.emails.length > MAX_BULK_INVITE_EMAILS) {
    return NextResponse.json(
      {
        error: `Too many emails: cap is ${MAX_BULK_INVITE_EMAILS} per request`,
      },
      { status: 422 }
    );
  }

  const { validEmails, preResults } = prepareBulkInviteEmails(body.emails);
  const results: BulkInviteResult[] = [...preResults];

  const existingMemberEmails = new Set<string>();
  if (validEmails.length > 0) {
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .in("email", validEmails);

    if (profilesError) {
      return NextResponse.json(
        { error: profilesError.message },
        { status: 500 }
      );
    }

    const profileIdByEmail = new Map<string, string>();
    for (const row of profiles ?? []) {
      const email = (row.email as string | null)?.toLowerCase() ?? null;
      const id = row.id as string | null;
      if (email && id) profileIdByEmail.set(email, id);
    }

    const profileIds = Array.from(profileIdByEmail.values());
    if (profileIds.length > 0) {
      const { data: members, error: membersError } = await supabaseAdmin
        .from("team_members")
        .select("user_id")
        .eq("team_id", teamId)
        .in("user_id", profileIds);

      if (membersError) {
        return NextResponse.json(
          { error: membersError.message },
          { status: 500 }
        );
      }

      const memberIds = new Set(
        (members ?? []).map((m) => m.user_id as string)
      );
      for (const [email, id] of profileIdByEmail.entries()) {
        if (memberIds.has(id)) existingMemberEmails.add(email);
      }
    }
  }

  const [teamResult, inviterResult] = await Promise.all([
    supabaseAdmin
      .from("teams")
      .select("id, name, slug")
      .eq("id", teamId)
      .single(),
    supabaseAdmin
      .from("profiles")
      .select("name, username")
      .eq("id", profileId)
      .single(),
  ]);

  if (teamResult.error || !teamResult.data) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const teamName = teamResult.data.name as string;
  const inviterName =
    (inviterResult.data?.name as string | null) ||
    (inviterResult.data?.username as string | null) ||
    null;

  for (const email of validEmails) {
    if (existingMemberEmails.has(email)) {
      results.push({ email, status: "skipped_member" });
    }
  }
  const toInvite = validEmails.filter(
    (email) => !existingMemberEmails.has(email)
  );

  for (const batch of chunkEmails(toInvite, BULK_INVITE_SEND_CONCURRENCY)) {
    const batchResults = await Promise.all(
      batch.map(async (email): Promise<BulkInviteResult> => {
        const token = generateInviteToken();
        const { data: inviteRow, error: insertError } = await supabaseAdmin
          .from("team_invites")
          .insert({
            team_id: teamId,
            email,
            role: role as BulkInviteRole,
            token,
            invited_by_user_id: profileId,
          })
          .select("id")
          .single();

        if (insertError || !inviteRow) {
          return { email, status: "insert_failed" };
        }

        const sendResult = await sendTeamInvite({
          email,
          teamName,
          inviterName,
          role: role as BulkInviteRole,
          token,
        });

        if (!sendResult.ok) {
          return {
            email,
            status: "delivery_failed",
            invite_id: inviteRow.id as string,
          };
        }
        return {
          email,
          status: "invited",
          invite_id: inviteRow.id as string,
        };
      })
    );
    results.push(...batchResults);
  }

  const summary = summarizeBulkInviteResults(results, body.emails.length);

  await recordTeamAuditEvent({
    productTeamId: teamId,
    actorUserId: profileId,
    action: "invite.bulk_created",
    targetType: "invite",
    targetId: teamId,
    payload: {
      role,
      ...summary,
    },
  });

  return NextResponse.json({ results, summary });
}
