import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { loadTeamMembershipAuth } from "@/lib/team-management";
import { recordTeamAuditEvent } from "@/lib/team-audit";
import {
  deleteTeamProviderKey,
  listTeamProviderKeys,
  storeTeamProviderKey,
  type Provider,
} from "@/lib/vault";

const VALID_PROVIDERS = new Set<Provider>([
  "ai_gateway",
  "anthropic",
  "openai",
  "openrouter",
]);

function isValidProvider(provider: string): provider is Provider {
  return VALID_PROVIDERS.has(provider as Provider);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ teamId: string }> }
) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const { teamId } = await context.params;
  const auth = await loadTeamMembershipAuth(teamId, profileId);
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

export async function PUT(
  request: Request,
  context: { params: Promise<{ teamId: string }> }
) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const { teamId } = await context.params;
  const auth = await loadTeamMembershipAuth(teamId, profileId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { provider?: unknown; key?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = typeof body.provider === "string" ? body.provider : "";
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!isValidProvider(provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({ error: "Key is required" }, { status: 400 });
  }

  try {
    await storeTeamProviderKey(teamId, provider, key);
    await recordTeamAuditEvent({
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

export async function DELETE(
  request: Request,
  context: { params: Promise<{ teamId: string }> }
) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const { teamId } = await context.params;
  const auth = await loadTeamMembershipAuth(teamId, profileId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { provider?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = typeof body.provider === "string" ? body.provider : "";
  if (!isValidProvider(provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  try {
    await deleteTeamProviderKey(teamId, provider);
    await recordTeamAuditEvent({
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
          error instanceof Error ? error.message : "Failed to delete team key",
      },
      { status: 500 }
    );
  }
}
