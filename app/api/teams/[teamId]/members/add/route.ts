import { z } from "zod";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canInviteRole, loadTeamMembershipAuth } from "@/lib/team-management";
import { recordTeamAuditEvent } from "@/lib/team-audit";
import { inviteSchema } from "../../invites/schema";

const defaults = {
  requireProfileId,
  db: supabaseAdmin,
  loadTeamMembershipAuth,
  recordTeamAuditEvent,
};

/** Explicit owner/admin action; never infers a role from GitHub membership. */
export function createAddTeamMemberHandler(
  overrides: Partial<typeof defaults> = {}
) {
  const deps = { ...defaults, ...overrides };
  return async function POST(
    request: Request,
    context: { params: Promise<{ teamId: string }> }
  ) {
    const actor = await deps.requireProfileId();
    if (actor instanceof Response) return actor;
    const params = z
      .object({ teamId: z.string().uuid() })
      .safeParse(await context.params);
    if (!params.success)
      return Response.json({ error: "Invalid team ID." }, { status: 400 });
    const { teamId } = params.data;
    const auth = await deps.loadTeamMembershipAuth(teamId, actor);
    if (!auth.ok)
      return Response.json({ error: auth.error }, { status: auth.status });
    const parsed = inviteSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success)
      return Response.json(
        { error: "Enter a valid email and role." },
        { status: 400 }
      );
    const { email, role } = parsed.data;
    if (!canInviteRole(auth.role, role))
      return Response.json({ error: "Forbidden" }, { status: 403 });
    const { data: user, error: userError } = await deps.db
      .from("user")
      .select("id")
      .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
      .eq("emailVerified", true)
      .maybeSingle();
    if (userError)
      return Response.json(
        { error: "Unable to find this account." },
        { status: 500 }
      );
    const { data: profile, error: profileError } = user
      ? await deps.db
          .from("profiles")
          .select("id")
          .eq("auth_user_id", user.id)
          .maybeSingle()
      : { data: null, error: null };
    if (profileError)
      return Response.json(
        { error: "Unable to find this account." },
        { status: 500 }
      );
    if (!profile)
      return Response.json(
        {
          error:
            "This person must sign up and verify their email first. Use Invite to send an invitation.",
        },
        { status: 404 }
      );
    const { error } = await deps.db.from("team_members").insert({
      team_id: teamId,
      user_id: profile.id,
      role,
      invited_by_user_id: actor,
    });
    if (error)
      return Response.json(
        {
          error:
            error.code === "23505"
              ? "This person is already a member."
              : "Unable to add this member.",
        },
        { status: error.code === "23505" ? 409 : 500 }
      );
    await deps.recordTeamAuditEvent({
      productTeamId: teamId,
      actorUserId: actor,
      action: "member.added",
      targetType: "member",
      targetId: profile.id,
      payload: { email, role },
    });
    return Response.json(
      { member: { userId: profile.id, role } },
      { status: 201 }
    );
  };
}
export const POST = createAddTeamMemberHandler();
