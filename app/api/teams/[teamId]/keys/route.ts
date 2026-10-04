import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { loadTeamMembershipAuth } from "@/lib/team-management";
import { recordTeamAuditEvent } from "@/lib/team-audit";
import {
  deleteTeamProviderKey,
  listTeamProviderKeys,
  storeTeamProviderKey,
} from "@/lib/vault";

import {
  teamKeyParamsSchema,
  storeTeamKeySchema,
  deleteTeamKeySchema,
} from "./schema";

const defaultDeps = {
  requireProfileId,
  loadTeamMembershipAuth,
  recordTeamAuditEvent,
};

export function createTeamProviderKeyHandlers(
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  async function GET(
    _request: Request,
    context: { params: Promise<{ teamId: string }> }
  ) {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) return profileId;

    const parsedParams = teamKeyParamsSchema.safeParse(await context.params);
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

    try {
      const keys = await listTeamProviderKeys(teamId);
      return NextResponse.json({
        keys,
        viewer: { role: auth.role, canManage: auth.canManage },
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to load team keys",
        },
        { status: 500 }
      );
    }
  }

  async function PUT(
    request: Request,
    context: { params: Promise<{ teamId: string }> }
  ) {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) return profileId;

    const parsedParams = teamKeyParamsSchema.safeParse(await context.params);
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

    const parsed = storeTeamKeySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid provider key.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { provider, key } = parsed.data;

    try {
      await storeTeamProviderKey(teamId, provider, key);
      await deps.recordTeamAuditEvent({
        productTeamId: teamId,
        actorUserId: profileId,
        action: "team_provider_key.updated",
        targetType: "provider_key",
        targetId: provider,
        payload: { provider },
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to store team key",
        },
        { status: 500 }
      );
    }
  }

  async function DELETE(
    request: Request,
    context: { params: Promise<{ teamId: string }> }
  ) {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) return profileId;

    const parsedParams = teamKeyParamsSchema.safeParse(await context.params);
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

    const parsed = deleteTeamKeySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid provider key.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { provider } = parsed.data;

    try {
      await deleteTeamProviderKey(teamId, provider);
      await deps.recordTeamAuditEvent({
        productTeamId: teamId,
        actorUserId: profileId,
        action: "team_provider_key.deleted",
        targetType: "provider_key",
        targetId: provider,
        payload: { provider },
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to delete team key",
        },
        { status: 500 }
      );
    }
  }
  return { GET, PUT, DELETE };
}

export const { GET, PUT, DELETE } = createTeamProviderKeyHandlers();
