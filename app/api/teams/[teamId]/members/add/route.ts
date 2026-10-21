import { z } from "zod";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canInviteRole, loadTeamMembershipAuth } from "@/lib/team-management";
import { inviteSchema } from "../../invites/schema";

const defaults = {
  requireProfileId,
  db: supabaseAdmin,
  loadTeamMembershipAuth,
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
    const { data, error } = await deps.db
      .rpc("add_verified_team_member", {
        p_team_id: teamId,
        p_actor_id: actor,
        p_email: email,
        p_role: role,
      })
      .maybeSingle<{
        member_user_id: string;
        member_role: "admin" | "developer" | "viewer";
      }>();
    if (error?.message.includes("member_add_account_unverified_or_missing"))
      return Response.json(
        {
          error:
            "This person must sign up and verify their email first. Use Invite to send an invitation.",
        },
        { status: 404 }
      );
    if (error?.message.includes("member_add_account_ambiguous"))
      return Response.json(
        {
          error:
            "More than one account uses this email. Contact support to choose the account.",
        },
        { status: 409 }
      );
    if (error?.message.includes("member_add_forbidden"))
      return Response.json({ error: "Forbidden" }, { status: 403 });
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
    if (!data)
      return Response.json(
        { error: "Unable to add this member." },
        { status: 500 }
      );
    return Response.json(
      { member: { userId: data.member_user_id, role: data.member_role } },
      { status: 201 }
    );
  };
}
export const POST = createAddTeamMemberHandler();
