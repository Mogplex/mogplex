import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { listPendingToolApprovals } from "@/lib/flows/wait-service";

type FlowApprovalsRouteDeps = {
  requireUserId: typeof requireUserId;
  listPendingToolApprovals: typeof listPendingToolApprovals;
};

export function createFlowApprovalsGetHandler(
  overrides: Partial<FlowApprovalsRouteDeps> = {}
) {
  const deps: FlowApprovalsRouteDeps = {
    requireUserId,
    listPendingToolApprovals,
    ...overrides,
  };

  return async function GET() {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    try {
      const { approvals, hasMore } =
        await deps.listPendingToolApprovals(userId);
      return NextResponse.json({ approvals, hasMore });
    } catch (error) {
      // Underlying errors carry Supabase/Postgres detail; keep the client
      // response generic and log the specifics server-side.
      console.error("[flow-approvals] failed to list pending approvals", {
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

export const GET = createFlowApprovalsGetHandler();
