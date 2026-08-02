import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  loadOwnedToolApprovalWait,
  resumeFlowWait,
} from "@/lib/flows/wait-service";

const APPROVAL_NOTE_MAX_LENGTH = 2_000;

type FlowApprovalResolveDeps = {
  requireUserId: typeof requireUserId;
  loadOwnedToolApprovalWait: typeof loadOwnedToolApprovalWait;
  resumeFlowWait: typeof resumeFlowWait;
};

function parseNote(note: unknown): { note: string | null } | { error: string } {
  if (note == null) return { note: null };
  if (typeof note !== "string") {
    return { error: "note must be a string" };
  }
  const trimmed = note.trim();
  if (trimmed.length === 0) return { note: null };
  if (trimmed.length > APPROVAL_NOTE_MAX_LENGTH) {
    return {
      error: `note must be at most ${APPROVAL_NOTE_MAX_LENGTH} characters`,
    };
  }
  return { note: trimmed };
}

function parseDecisionBody(
  body: unknown
): { decision: "approve" | "deny"; note: string | null } | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  if (record.decision !== "approve" && record.decision !== "deny") {
    return { error: 'decision must be "approve" or "deny"' };
  }
  const note = parseNote(record.note);
  if ("error" in note) return note;
  return { decision: record.decision, note: note.note };
}

export function createFlowApprovalResolvePostHandler(
  overrides: Partial<FlowApprovalResolveDeps> = {}
) {
  const deps: FlowApprovalResolveDeps = {
    requireUserId,
    loadOwnedToolApprovalWait,
    resumeFlowWait,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON" },
        { status: 400 }
      );
    }
    const parsed = parseDecisionBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { id } = await params;
    const wait = await deps.loadOwnedToolApprovalWait(userId, id);
    if (!wait) {
      return NextResponse.json(
        { error: "Approval not found" },
        { status: 404 }
      );
    }
    const decidedAt = new Date().toISOString();
    // A wait whose promised window has lapsed must never resolve, even while
    // the runner's own timeout path has not finalized the row yet. Checked
    // here for a fast 409 and enforced atomically in the CAS via
    // notExpiredAt for the load→update race.
    if (
      wait.status !== "waiting" ||
      (wait.expires_at !== null &&
        new Date(wait.expires_at).getTime() <= Date.parse(decidedAt))
    ) {
      return NextResponse.json(
        { error: "Approval is no longer pending" },
        { status: 409 }
      );
    }

    const outcome = await deps.resumeFlowWait({
      candidate: wait,
      payload: {
        decision: parsed.decision,
        note: parsed.note,
        decided_by: userId,
        decided_at: decidedAt,
      },
      deliveryId: null,
      notExpiredAt: wait.expires_at ? decidedAt : undefined,
    });

    if (outcome.resumed) {
      return NextResponse.json({ ok: true, decision: parsed.decision });
    }
    if (outcome.reason === "already_resumed") {
      return NextResponse.json(
        { error: "Approval was already resolved" },
        { status: 409 }
      );
    }
    // complete_failed: the wait row was rolled back (or stranded — logged
    // loudly inside resumeFlowWait); the client can retry. The provider's
    // failure message stays in the server log — it can carry Trigger.dev /
    // internal execution detail that must not reach the client.
    console.error("[flow-approvals] failed to deliver approval decision", {
      userId,
      waitId: wait.id,
      error: outcome.message ?? null,
      rollbackFailed: outcome.rollbackFailed === true,
    });
    return NextResponse.json(
      { error: "Failed to deliver the decision; try again" },
      { status: 502 }
    );
  };
}

export const POST = createFlowApprovalResolvePostHandler();
