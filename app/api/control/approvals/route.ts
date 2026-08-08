import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { listPendingControlApprovals } from "@/lib/control/approvals-store";

type ControlApprovalsRouteDeps = {
  requireUserId: typeof requireUserId;
  listPendingControlApprovals: typeof listPendingControlApprovals;
};

export function createControlApprovalsGetHandler(
  overrides: Partial<ControlApprovalsRouteDeps> = {}
) {
  const deps: ControlApprovalsRouteDeps = {
    requireUserId,
    listPendingControlApprovals,
    ...overrides,
  };

  return async function GET(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const runId = new URL(request.url).searchParams.get("runId");
    try {
      const approvals = await deps.listPendingControlApprovals({
        userId,
        runId: runId || null,
      });
      return NextResponse.json({ approvals });
    } catch (error) {
      console.error("[control-approvals] failed to list pending approvals", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Failed to load approvals" },
        { status: 500 }
      );
    }
  };
}

export const GET = createControlApprovalsGetHandler();
