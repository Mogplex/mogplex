import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTeamMembershipAuth } from "@/lib/team-management";
import { recordTeamAuditEvent } from "@/lib/team-audit";
import type { RecordTeamAuditEventInput } from "@/lib/team-audit";

type TransferOwnershipRouteContext = {
  params: Promise<{ teamId: string }>;
};

type TransferOwnershipDeps = {
  requireProfileId: typeof requireProfileId;
  loadTeamMembershipAuth: typeof loadTeamMembershipAuth;
  transferOwnership: (
    teamId: string,
    currentOwnerUserId: string,
    nextOwnerUserId: string
  ) => Promise<{ error: { message: string; code?: string } | null }>;
  recordTeamAuditEvent: (input: RecordTeamAuditEventInput) => Promise<unknown>;
};

const defaultTransferOwnershipDeps: TransferOwnershipDeps = {
  requireProfileId,
  loadTeamMembershipAuth,
  async transferOwnership(teamId, currentOwnerUserId, nextOwnerUserId) {
    const { error } = await supabaseAdmin.rpc("transfer_team_ownership", {
      p_team_id: teamId,
      p_current_owner_user_id: currentOwnerUserId,
      p_next_owner_user_id: nextOwnerUserId,
    });
    return {
      error: error ? { message: error.message, code: error.code } : null,
    };
  },
  recordTeamAuditEvent,
};

function mapTransferError(error: { message: string; code?: string }) {
  if (error.code === "P0002") {
    return NextResponse.json(
      { error: "Team member not found" },
      { status: 404 }
    );
  }
  if (error.code === "23514") {
    return NextResponse.json(
      { error: "Cannot transfer ownership to that member" },
      { status: 422 }
    );
  }
  if (error.code === "P0001") {
    return NextResponse.json(
      { error: "Failed to transfer ownership" },
      { status: 500 }
    );
  }
  if (error.code === "42501") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(
    { error: "Failed to transfer ownership" },
    { status: 500 }
  );
}

export function createTransferOwnershipPostHandler(
  overrides: Partial<TransferOwnershipDeps> = {}
) {
  const deps: TransferOwnershipDeps = {
    ...defaultTransferOwnershipDeps,
    ...overrides,
  };

  return async function POST(
    request: Request,
    context: TransferOwnershipRouteContext
  ) {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) return profileId;

    const { teamId } = await context.params;
    const auth = await deps.loadTeamMembershipAuth(teamId, profileId);
    if (!auth.ok) {
      if (auth.status === 500) {
        return NextResponse.json(
          { error: "Internal server error" },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: { next_owner_user_id?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const nextOwnerUserId =
      typeof body.next_owner_user_id === "string"
        ? body.next_owner_user_id.trim()
        : "";
    if (!nextOwnerUserId) {
      return NextResponse.json(
        { error: "next_owner_user_id is required" },
        { status: 422 }
      );
    }
    if (nextOwnerUserId === profileId) {
      return NextResponse.json(
        { error: "Select another admin to become owner" },
        { status: 422 }
      );
    }

    const { error } = await deps.transferOwnership(
      teamId,
      profileId,
      nextOwnerUserId
    );
    if (error) return mapTransferError(error);

    await deps.recordTeamAuditEvent({
      productTeamId: teamId,
      actorUserId: profileId,
      action: "team.owner_transferred",
      targetType: "member",
      targetId: nextOwnerUserId,
      payload: {
        from_owner_user_id: profileId,
        to_owner_user_id: nextOwnerUserId,
      },
    });

    return NextResponse.json({ ok: true });
  };
}

export const POST = createTransferOwnershipPostHandler();
