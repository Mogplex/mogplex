import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTeamMembershipAuth } from "@/lib/team-management";
import { recordTeamAuditEvent } from "@/lib/team-audit";
import {
  attachInstallationSchema,
  teamInstallationParamsSchema,
} from "./schema";

type AttachedInstallation = {
  id: string;
  installation_id: number;
  account_login: string | null;
  account_type: string | null;
  target_type: string | null;
  product_team_id: string;
  attached_by_user_id: string;
};

export type AttachInstallationResponse = {
  attached: AttachedInstallation;
};

export type ListTeamInstallationsResponse = {
  installations: AttachedInstallation[];
};

const defaultDeps = {
  requireProfileId,
  db: supabaseAdmin,
  loadTeamMembershipAuth,
  recordTeamAuditEvent,
};

export function createTeamInstallationHandlers(
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  async function GET(
    _request: Request,
    context: { params: Promise<{ teamId: string }> }
  ) {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) return profileId;

    const parsedParams = teamInstallationParamsSchema.safeParse(
      await context.params
    );
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid team ID.", details: parsedParams.error.flatten() },
        { status: 400 }
      );
    }
    const { teamId } = parsedParams.data;
    const auth = await deps.loadTeamMembershipAuth(teamId, profileId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    if (!auth.canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await deps.db
      .from("github_installations")
      .select(
        "id, installation_id, account_login, account_type, target_type, product_team_id, user_id"
      )
      .eq("product_team_id", teamId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const installations: AttachedInstallation[] = (data ?? []).map((row) => ({
      id: row.id as string,
      installation_id: Number(row.installation_id),
      account_login: (row.account_login as string | null) ?? null,
      account_type: (row.account_type as string | null) ?? null,
      target_type: (row.target_type as string | null) ?? null,
      product_team_id: row.product_team_id as string,
      attached_by_user_id: row.user_id as string,
    }));

    return NextResponse.json({ installations });
  }

  async function POST(
    request: Request,
    context: { params: Promise<{ teamId: string }> }
  ) {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) return profileId;

    const parsedParams = teamInstallationParamsSchema.safeParse(
      await context.params
    );
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid team ID.", details: parsedParams.error.flatten() },
        { status: 400 }
      );
    }
    const { teamId } = parsedParams.data;

    // Authorize before parsing/validating the payload so unauthenticated callers
    // can't use validation responses to probe team existence.
    const auth = await deps.loadTeamMembershipAuth(teamId, profileId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    if (!auth.canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = attachInstallationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid installation ID.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const installationId = parsed.data.installation_id;

    const { data: existing, error: existingError } = await deps.db
      .from("github_installations")
      .select(
        "id, installation_id, account_login, account_type, target_type, product_team_id, user_id"
      )
      .eq("user_id", profileId)
      .eq("installation_id", installationId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { error: existingError.message },
        { status: 500 }
      );
    }
    if (!existing) {
      return NextResponse.json(
        { error: "Installation not found for this user" },
        { status: 404 }
      );
    }

    if (existing.product_team_id && existing.product_team_id !== teamId) {
      return NextResponse.json(
        { error: "Installation is already attached to a different team" },
        { status: 409 }
      );
    }

    const alreadyAttachedToThisTeam = existing.product_team_id === teamId;

    if (!alreadyAttachedToThisTeam) {
      const { error: updateError } = await deps.db
        .from("github_installations")
        .update({ product_team_id: teamId })
        .eq("id", existing.id);

      if (updateError) {
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        );
      }

      await deps.recordTeamAuditEvent({
        productTeamId: teamId,
        actorUserId: profileId,
        action: "team.installation.attached",
        targetType: "github_installation",
        targetId: existing.id as string,
        payload: {
          installation_id: Number(existing.installation_id),
          account_login: (existing.account_login as string | null) ?? null,
        },
      });
    }

    const attached: AttachedInstallation = {
      id: existing.id as string,
      installation_id: Number(existing.installation_id),
      account_login: (existing.account_login as string | null) ?? null,
      account_type: (existing.account_type as string | null) ?? null,
      target_type: (existing.target_type as string | null) ?? null,
      product_team_id: teamId,
      attached_by_user_id: existing.user_id as string,
    };

    return NextResponse.json(
      { attached },
      { status: alreadyAttachedToThisTeam ? 200 : 201 }
    );
  }
  return { GET, POST };
}

export const { GET, POST } = createTeamInstallationHandlers();
