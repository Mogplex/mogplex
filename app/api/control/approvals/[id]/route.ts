import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { resolveControlApproval } from "@/lib/control/approvals-store";

const APPROVAL_NOTE_MAX_LENGTH = 2_000;

type ControlApprovalResolveDeps = {
  requireUserId: typeof requireUserId;
  resolveControlApproval: typeof resolveControlApproval;
};

function parseDecisionBody(
  body: unknown
):
  | { decision: "approved" | "denied"; note: string | null }
  | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  if (record.decision !== "approve" && record.decision !== "deny") {
    return { error: 'decision must be "approve" or "deny"' };
  }
  if (record.note != null && typeof record.note !== "string") {
    return { error: "note must be a string" };
  }
  const note = typeof record.note === "string" ? record.note.trim() : "";
  if (note.length > APPROVAL_NOTE_MAX_LENGTH) {
    return {
      error: `note must be at most ${APPROVAL_NOTE_MAX_LENGTH} characters`,
    };
  }
  return {
    decision: record.decision === "approve" ? "approved" : "denied",
    note: note.length > 0 ? note : null,
  };
}

export function createControlApprovalResolvePostHandler(
  overrides: Partial<ControlApprovalResolveDeps> = {}
) {
  const deps: ControlApprovalResolveDeps = {
    requireUserId,
    resolveControlApproval,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Request body must be JSON" },
        { status: 400 }
      );
    }
    const parsed = parseDecisionBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    try {
      const resolved = await deps.resolveControlApproval({
        approvalId: id,
        userId,
        decision: parsed.decision,
        source: "api",
        note: parsed.note,
      });
      if (!resolved) {
        // Already resolved, expired, or not owned by this user — the RPC
        // does not distinguish, and neither should the client.
        return NextResponse.json(
          { error: "Approval is no longer pending" },
          { status: 409 }
        );
      }
      return NextResponse.json({ ok: true, decision: parsed.decision });
    } catch (error) {
      console.error("[control-approvals] failed to resolve approval", {
        userId,
        approvalId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Failed to resolve approval" },
        { status: 500 }
      );
    }
  };
}

export const POST = createControlApprovalResolvePostHandler();
