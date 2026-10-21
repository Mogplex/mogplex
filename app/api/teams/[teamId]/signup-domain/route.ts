import { z } from "zod";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTeamMembershipAuth } from "@/lib/team-management";
import { verifiedWorkEmailDomain } from "@/lib/team-signup-domain";

const defaults = {
  requireProfileId,
  loadTeamMembershipAuth,
  async read(teamId: string, profileId: string) {
    const { data: team, error } = await supabaseAdmin
      .from("teams")
      .select("signup_email_domain, signup_email_domain_enabled")
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
      enabled: team.signup_email_domain_enabled === true,
      eligibleDomain: verifiedWorkEmailDomain(
        user?.email ?? null,
        user?.emailVerified === true
      ),
    };
  },
  async write(
    teamId: string,
    profileId: string,
    domain: string | null,
    enabled: boolean
  ) {
    const { error } = await supabaseAdmin.rpc("set_team_signup_domain", {
      p_team_id: teamId,
      p_actor_id: profileId,
      p_domain: domain,
      p_enabled: enabled,
    });
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
      let { domain, enabled } = setting;
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
        if (
          body.data.enabled &&
          setting.domain &&
          setting.domain !== setting.eligibleDomain
        ) {
          return Response.json(
            {
              error:
                "Use a verified email from the configured domain to turn this on.",
            },
            { status: 403 }
          );
        }
        enabled = body.data.enabled;
        domain = setting.domain ?? (enabled ? setting.eligibleDomain : null);
        await deps.write(teamId, profileId, domain, enabled);
      }
      return Response.json({
        domain,
        enabled,
        eligibleDomain: setting.eligibleDomain,
        viewer: { canManage: auth.canManage },
      });
    } catch (error) {
      console.error("[team-signup-domain] request failed", error);
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
