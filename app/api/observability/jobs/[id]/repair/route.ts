import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { loadOwnedJobRun } from "@/lib/job-run-service";
import { isRepairableJobRun } from "@/lib/job-runs";
import {
  serializeAutomationJobStart,
  startAutomationJobRun,
} from "@/lib/workflows/automation-job-workflow";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { id } = await params;
  const { run } = await loadOwnedJobRun(userId, id);

  if (!run) {
    return NextResponse.json({ error: "Job run not found" }, { status: 404 });
  }

  if (!isRepairableJobRun(run)) {
    return NextResponse.json(
      { error: "Job run is not repairable" },
      { status: 400 }
    );
  }

  try {
    const started = await startAutomationJobRun(id, "repair");
    return NextResponse.json({
      ok: true,
      ...serializeAutomationJobStart(started),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to repair job run",
      },
      { status: 500 }
    );
  }
}
