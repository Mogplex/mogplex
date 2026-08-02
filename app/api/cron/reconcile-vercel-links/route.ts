import { NextResponse } from "next/server";
import { requireMachineApiAuth } from "@/lib/internal-api-auth";
import {
  buildVercelLinkReconciliationMessage,
  runVercelLinkReconciliation,
} from "@/lib/vercel/reconcile-links-runner";
import type { VercelLinkReconciliationSummary } from "@/lib/vercel/reconcile-links-runner";

type ReconcileVercelLinksDeps = {
  requireMachineApiAuth: typeof requireMachineApiAuth;
  runVercelLinkReconciliation: () => Promise<VercelLinkReconciliationSummary>;
};

const defaultDeps: ReconcileVercelLinksDeps = {
  requireMachineApiAuth,
  runVercelLinkReconciliation,
};

export function createReconcileVercelLinksGetHandler(
  overrides: Partial<ReconcileVercelLinksDeps> = {}
) {
  const deps: ReconcileVercelLinksDeps = {
    ...defaultDeps,
    ...overrides,
  };

  return async function GET(req: Request) {
    const authResponse = deps.requireMachineApiAuth(
      req,
      "/api/cron/reconcile-vercel-links"
    );
    if (authResponse) return authResponse;

    try {
      const summary = await deps.runVercelLinkReconciliation();

      return NextResponse.json({
        message: buildVercelLinkReconciliationMessage(summary),
        ...summary,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to reconcile Vercel links";
      console.error("[vercel-link-reconcile] failed", { error: message });
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export const GET = createReconcileVercelLinksGetHandler();
