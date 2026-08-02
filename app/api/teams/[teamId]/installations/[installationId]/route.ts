import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTeamMembershipAuth } from "@/lib/team-management";
import { recordTeamAuditEvent } from "@/lib/team-audit";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ teamId: string; installationId: string }> }
) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const { teamId, installationId: installationIdParam } = await context.params;
  const installationId = /^\d+$/.test(installationIdParam)
    ? Number(installationIdParam)
    : NaN;

  if (!Number.isFinite(installationId)) {
    return NextResponse.json(
      { error: "installationId must be numeric" },
      { status: 422 }
    );
  }

  const auth = await loadTeamMembershipAuth(teamId, profileId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Intentionally scoped to (installation_id, product_team_id) — NOT to the
  // attacher's user_id. Any team manager can detach an installation from the
  // team they manage, even if a different user originally attached it. This
  // matches the "team manager controls team-scoped resources" model. Detach
  // only nulls product_team_id; it does not affect the attacher's ownership
  // of the github_installations row itself.
  const { data: row, error: lookupError } = await supabaseAdmin
    .from("github_installations")
    .select("id, installation_id, account_login")
    .eq("installation_id", installationId)
    .eq("product_team_id", teamId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json(
      { error: "Installation not attached to this team" },
      { status: 404 }
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from("github_installations")
    .update({ product_team_id: null })
    .eq("id", row.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await recordTeamAuditEvent({
    productTeamId: teamId,
    actorUserId: profileId,
    action: "team.installation.detached",
    targetType: "github_installation",
    targetId: row.id as string,
    payload: {
      installation_id: Number(row.installation_id),
      account_login: (row.account_login as string | null) ?? null,
    },
  });

  return NextResponse.json({ detached: true });
}
