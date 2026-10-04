import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTeamMembershipAuth } from "@/lib/team-management";
import { recordTeamAuditEvent } from "@/lib/team-audit";
import { teamModelParamsSchema, teamModelsSchema } from "./schema";

export type TeamModelsResponse = {
  modelAllowlist: string[] | null;
  viewer: { canManage: boolean };
};

const defaultDeps = {
  requireProfileId,
  db: supabaseAdmin,
  loadTeamMembershipAuth,
  recordTeamAuditEvent,
};

export function createTeamModelHandlers(
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  async function loadModelIds(modelIds: readonly string[]) {
    if (modelIds.length === 0) return new Set<string>();
    const { data, error } = await deps.db
      .from("ai_models")
      .select("id")
      .in("id", [...modelIds]);
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((row) => row.id as string));
  }

  async function GET(
    _request: Request,
    context: { params: Promise<{ teamId: string }> }
  ) {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) return profileId;

    const parsedParams = teamModelParamsSchema.safeParse(await context.params);
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

    const { data, error } = await deps.db
      .from("teams")
      .select("model_allowlist")
      .eq("id", teamId)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Team not found" },
        { status: error ? 500 : 404 }
      );
    }

    return NextResponse.json({
      modelAllowlist: (data.model_allowlist as string[] | null) ?? null,
      viewer: { canManage: auth.canManage },
    });
  }

  async function PATCH(
    request: Request,
    context: { params: Promise<{ teamId: string }> }
  ) {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) return profileId;

    const parsedParams = teamModelParamsSchema.safeParse(await context.params);
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = teamModelsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid model list.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const modelAllowlist = parsed.data.model_allowlist;

    try {
      const existingIds = await loadModelIds(modelAllowlist ?? []);
      const missing = (modelAllowlist ?? []).filter(
        (id) => !existingIds.has(id)
      );
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Unknown model IDs: ${missing.join(", ")}` },
          { status: 422 }
        );
      }
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to validate models",
        },
        { status: 500 }
      );
    }

    const { data: currentTeam, error: currentError } = await deps.db
      .from("teams")
      .select("model_allowlist")
      .eq("id", teamId)
      .single();
    if (currentError || !currentTeam) {
      return NextResponse.json(
        { error: currentError?.message || "Team not found" },
        { status: currentError ? 500 : 404 }
      );
    }

    const { error } = await deps.db
      .from("teams")
      .update({ model_allowlist: modelAllowlist })
      .eq("id", teamId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await deps.recordTeamAuditEvent({
      productTeamId: teamId,
      actorUserId: profileId,
      action: "model_allowlist.changed",
      targetType: "team",
      targetId: teamId,
      payload: {
        from_model_allowlist:
          (currentTeam.model_allowlist as string[] | null) ?? null,
        to_model_allowlist: modelAllowlist,
      },
    });

    return NextResponse.json({ ok: true });
  }
  return { GET, PATCH };
}

export const { GET, PATCH } = createTeamModelHandlers();
