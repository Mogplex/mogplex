import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extendSandboxLifetime as extendSandboxTimeout } from "@/lib/sandbox/sdk-adapter";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteContext,
} from "@/lib/sandbox/route-context";

type ExtendSandboxRecord = {
  id: string;
  sandbox_id: string;
  status: string;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
};

const MIN_EXTEND_MINUTES = 1;
const MAX_EXTEND_MINUTES = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const minutes = Number(body.minutes);
  if (
    !Number.isFinite(minutes) ||
    minutes < MIN_EXTEND_MINUTES ||
    minutes > MAX_EXTEND_MINUTES
  ) {
    return NextResponse.json(
      {
        error: `minutes must be between ${MIN_EXTEND_MINUTES} and ${MAX_EXTEND_MINUTES}`,
      },
      { status: 400 }
    );
  }

  const sandboxData = await loadOwnedSandboxRouteContext<ExtendSandboxRecord>(
    request,
    id,
    {
      select:
        "id, sandbox_id, status, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id",
      requireCapability: "tools.bash",
    }
  );
  if (!sandboxData.ok) return buildSandboxRouteErrorResponse(sandboxData);
  const { record } = sandboxData;
  if (record.status !== "running") {
    return NextResponse.json(
      { error: "Sandbox is not running" },
      { status: 400 }
    );
  }
  if (!sandboxData.sandbox) {
    return NextResponse.json(
      { error: "Sandbox is not ready" },
      { status: 409 }
    );
  }

  const durationMs = minutes * 60 * 1000;
  await extendSandboxTimeout(sandboxData.sandbox, durationMs);

  // Touch last_active_at to reflect the extension
  await supabaseAdmin
    .from("sandboxes")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true, extendedByMs: durationMs });
}
