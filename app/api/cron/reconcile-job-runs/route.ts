import { NextResponse } from "next/server";
import { requireMachineApiAuth } from "@/lib/internal-api-auth";
import { reconcileAutomationJobRuns } from "@/lib/workflows/job-run-cancel";

export async function GET(req: Request) {
  const authResponse = requireMachineApiAuth(
    req,
    "/api/cron/reconcile-job-runs"
  );
  if (authResponse) return authResponse;

  try {
    const results = await reconcileAutomationJobRuns();

    return NextResponse.json({
      message: `Reconciled ${results.length} job run(s)`,
      reconciled: results.filter((result) => result.outcome !== "skipped")
        .length,
      skipped: results.filter((result) => result.outcome === "skipped").length,
      results,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reconcile job runs";
    console.error("[job-reconcile] failed to reconcile job runs", {
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
