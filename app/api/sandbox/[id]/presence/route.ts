import { NextResponse } from "next/server";
import {
  normalizeSandboxPresencePayload,
  queueSandboxAutoPauseCheck,
  recordSandboxClientAttach,
  recordSandboxClientRelease,
  resolveSandboxAutoPauseGracePeriodMs,
} from "@/lib/sandbox/auto-pause";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteRecord,
} from "@/lib/sandbox/route-context";

type SandboxPresenceRecord = {
  id: string;
  user_id: string;
  sandbox_id: string;
};

type SandboxPresenceDeps = {
  loadOwnedSandboxRouteRecord: typeof loadOwnedSandboxRouteRecord;
  recordSandboxClientAttach: typeof recordSandboxClientAttach;
  recordSandboxClientRelease: typeof recordSandboxClientRelease;
  queueSandboxAutoPauseCheck: typeof queueSandboxAutoPauseCheck;
  resolveSandboxAutoPauseGracePeriodMs: typeof resolveSandboxAutoPauseGracePeriodMs;
};

const defaultSandboxPresenceDeps: SandboxPresenceDeps = {
  loadOwnedSandboxRouteRecord,
  recordSandboxClientAttach,
  recordSandboxClientRelease,
  queueSandboxAutoPauseCheck,
  resolveSandboxAutoPauseGracePeriodMs,
};

export function createSandboxPresenceHandler(
  overrides: Partial<SandboxPresenceDeps> = {}
) {
  const deps: SandboxPresenceDeps = {
    ...defaultSandboxPresenceDeps,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    const loaded =
      await deps.loadOwnedSandboxRouteRecord<SandboxPresenceRecord>(
        request,
        id,
        {
          select: "id, user_id, sandbox_id",
          notFoundMessage: "Sandbox not found",
        }
      );
    if (!loaded.ok) return buildSandboxRouteErrorResponse(loaded);

    let payload: ReturnType<typeof normalizeSandboxPresencePayload>;
    try {
      payload = normalizeSandboxPresencePayload(await request.json());
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid payload" },
        { status: 400 }
      );
    }

    const presence = {
      sandboxRecordId: loaded.record.id,
      sandboxId: loaded.record.sandbox_id,
      userId: loaded.auth.userId,
      tabId: payload.tabId,
      sessionId: payload.sessionId,
      eventSeq: payload.eventSeq,
    };

    if (payload.event === "attach") {
      await deps.recordSandboxClientAttach(presence);
      return NextResponse.json({ attached: true });
    }

    const release = await deps.recordSandboxClientRelease({
      ...presence,
      releaseReason: payload.releaseReason,
    });
    if (!release.shouldQueue) {
      return NextResponse.json({ released: false, queued: false });
    }
    if (
      !release.sessionRowId ||
      !release.releasedAt ||
      !release.releaseEventId
    ) {
      throw new Error("Sandbox release is missing auto-pause queue metadata");
    }

    const gracePeriodMs = deps.resolveSandboxAutoPauseGracePeriodMs();
    await deps.queueSandboxAutoPauseCheck({
      ...presence,
      sessionRowId: release.sessionRowId,
      releasedAt: release.releasedAt,
      releaseEventId: release.releaseEventId,
      gracePeriodMs,
    });

    return NextResponse.json({
      released: release.released,
      queued: true,
      gracePeriodMs,
    });
  };
}

export const POST = createSandboxPresenceHandler();
