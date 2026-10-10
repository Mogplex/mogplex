import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import {
  isApiKeyAccess,
  type ApiKeyAccess,
} from "@/lib/mogplex-api/key-access";
import { loadTeamApiKeyAccessById } from "@/lib/mogplex-api/team-key-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordTeamAuditEvent } from "@/lib/team-audit";
import { loadTeamMembershipAuth } from "@/lib/team-management";

export type TeamApiKeyAccessResponse = {
  access: ApiKeyAccess;
  viewer: { canManage: boolean };
};

type TeamApiKeyAccessDeps = {
  /** Resolves the signed-in profile id, or the response that turns them away. */
  requireProfileId: () => Promise<string | Response>;
  loadTeamMembershipAuth: typeof loadTeamMembershipAuth;
  read: (teamId: string) => Promise<ApiKeyAccess | null>;
  /** Returns false when the team does not exist. */
  write: (teamId: string, access: ApiKeyAccess) => Promise<boolean>;
  /** Runs after a stored change. A failure here never undoes the change. */
  onChanged: (change: {
    teamId: string;
    actorId: string;
    from: ApiKeyAccess;
    to: ApiKeyAccess;
  }) => Promise<void>;
};

async function writeTeamApiKeyAccess(teamId: string, access: ApiKeyAccess) {
  const { data, error } = await supabaseAdmin
    .from("teams")
    .update({ api_key_access: access })
    .eq("id", teamId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

const defaultDeps: TeamApiKeyAccessDeps = {
  requireProfileId,
  loadTeamMembershipAuth,
  read: loadTeamApiKeyAccessById,
  write: writeTeamApiKeyAccess,
  onChanged: async (change) => {
    await recordTeamAuditEvent({
      productTeamId: change.teamId,
      actorUserId: change.actorId,
      action: "api_key_access.changed",
      targetType: "team",
      targetId: change.teamId,
      payload: { from_access: change.from, to_access: change.to },
    });
  },
};

type RouteContext = { params: Promise<{ teamId: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

/** The one accepted body field, or null for anything that is not a level. */
async function readAccess(request: Request): Promise<ApiKeyAccess | null> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { access } = body as Record<string, unknown>;
  return isApiKeyAccess(access) ? access : null;
}

/**
 * Whether members' Mogplex API keys may act directly on this team's
 * repositories, or only trigger automations with an API trigger there. Any
 * member can read it; only a team owner can change it, and every change is
 * written to the team's audit log.
 */
export function createTeamApiKeyAccessHandlers(
  overrides: Partial<TeamApiKeyAccessDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };

  const resolveMember = async (context: RouteContext) => {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) {
      return { ok: false as const, response: profileId };
    }
    const { teamId } = await context.params;
    const auth = await deps.loadTeamMembershipAuth(teamId, profileId);
    if (!auth.ok) {
      return {
        ok: false as const,
        response: json({ error: auth.error }, auth.status),
      };
    }
    return {
      ok: true as const,
      teamId,
      profileId,
      isOwner: auth.role === "owner",
    };
  };

  return {
    async GET(_request: Request, context: RouteContext) {
      const member = await resolveMember(context);
      if (!member.ok) return member.response;
      try {
        const access = await deps.read(member.teamId);
        if (access === null) return json({ error: "Not found" }, 404);
        const body: TeamApiKeyAccessResponse = {
          access,
          viewer: { canManage: member.isOwner },
        };
        return json(body);
      } catch (error) {
        console.error("[teams] failed to load API key access", { error });
        return json({ error: "Unable to load the setting" }, 500);
      }
    },

    async PATCH(request: Request, context: RouteContext) {
      const member = await resolveMember(context);
      if (!member.ok) return member.response;
      if (!member.isOwner) {
        return json(
          { error: "Only a team owner can change API key access" },
          403
        );
      }

      const access = await readAccess(request);
      if (access === null) {
        return json({ error: "access must be 'full' or 'automations'" }, 422);
      }

      try {
        const previous = await deps.read(member.teamId);
        if (previous === null) return json({ error: "Not found" }, 404);
        if (!(await deps.write(member.teamId, access))) {
          return json({ error: "Not found" }, 404);
        }
        if (previous !== access) {
          await deps
            .onChanged({
              teamId: member.teamId,
              actorId: member.profileId,
              from: previous,
              to: access,
            })
            .catch((error: unknown) => {
              console.warn("[teams] failed to audit an API key access change", {
                error,
              });
            });
        }
        const response: TeamApiKeyAccessResponse = {
          access,
          viewer: { canManage: true },
        };
        return json(response);
      } catch (error) {
        console.error("[teams] failed to save API key access", { error });
        return json(
          { error: "Unable to save the setting. No changes were applied." },
          500
        );
      }
    },
  };
}

export const { GET, PATCH } = createTeamApiKeyAccessHandlers();
