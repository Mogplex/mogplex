import { z } from "zod";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTeamMembershipAuth } from "@/lib/team-management";
import { recordTeamAuditEvent } from "@/lib/team-audit";
import { verifiedWorkEmailDomain } from "@/lib/team-signup-domain";

const defaults = {
  requireProfileId,
  loadTeamMembershipAuth,
  recordTeamAuditEvent,
  async read(teamId: string, profileId: string) {
    const { data: team, error } = await supabaseAdmin
      .from("teams")
      .select("signup_email_domain")
      .eq("id", teamId)
      .single();
    if (error) throw new Error("Unable to load this setting.");
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("auth_user_id")
      .eq("id", profileId)
      .single();
    if (profileError) throw new Error("Unable to load this setting.");
    const { data: user, error: userError } = await supabaseAdmin
      .from("user")
      .select("email, emailVerified")
      .eq("id", profile?.auth_user_id)
      .maybeSingle();
    if (userError) throw new Error("Unable to load this setting.");
    return {
      domain: team.signup_email_domain as string | null,
      eligibleDomain: verifiedWorkEmailDomain(
        user?.email ?? null,
        user?.emailVerified === true
      ),
    };
  },
  async write(teamId: string, domain: string | null) {
    const { error } = await supabaseAdmin
      .from("teams")
      .update({ signup_email_domain: domain })
      .eq("id", teamId);
    if (error) throw new Error("Unable to save this setting.");
  },
};
type Context = { params: Promise<{ teamId: string }> };

export function createTeamSignupDomainHandlers(
  overrides: Partial<typeof defaults> = {}
) {
  const deps = { ...defaults, ...overrides };
  async function handle(request: Request, context: Context, save: boolean) {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) return profileId;
    const parsed = z
      .object({ teamId: z.string().uuid() })
      .safeParse(await context.params);
    if (!parsed.success)
      return Response.json({ error: "Invalid team ID." }, { status: 400 });
    const { teamId } = parsed.data;
    const auth = await deps.loadTeamMembershipAuth(teamId, profileId);
    if (!auth.ok)
      return Response.json({ error: auth.error }, { status: auth.status });
    if (save && !auth.canManage)
      return Response.json({ error: "Forbidden" }, { status: 403 });
    try {
      const setting = await deps.read(teamId, profileId);
      let domain = setting.domain;
      if (save) {
        const body = z
          .object({ enabled: z.boolean() })
          .strict()
          .safeParse(await request.json().catch(() => null));
        if (!body.success)
          return Response.json(
            { error: "Choose whether domain joining is on." },
            { status: 400 }
          );
        if (body.data.enabled && !setting.eligibleDomain) {
          return Response.json(
            {
              error: "Verify a work email before you allow its domain to join.",
            },
            { status: 400 }
          );
        }
        domain = body.data.enabled ? setting.eligibleDomain : null;
        await deps.write(teamId, domain);
        await deps.recordTeamAuditEvent({
          productTeamId: teamId,
          actorUserId: profileId,
          action: "team.signup_domain.changed",
          targetType: "team",
          targetId: teamId,
          payload: { from_domain: setting.domain, to_domain: domain },
        });
      }
      return Response.json({
        domain,
        eligibleDomain: setting.eligibleDomain,
        viewer: { canManage: auth.canManage },
      });
    } catch {
      return Response.json(
        {
          error: save
            ? "Unable to save this setting."
            : "Unable to load this setting.",
        },
        { status: 500 }
      );
    }
  }
  return {
    GET: (request: Request, context: Context) =>
      handle(request, context, false),
    PATCH: (request: Request, context: Context) =>
      handle(request, context, true),
  };
}
export const { GET, PATCH } = createTeamSignupDomainHandlers();
