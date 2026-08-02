import { NextResponse } from "next/server";
import {
  getSandboxServiceCredentials,
  isSandboxCapabilityDeniedError,
} from "@/lib/sandbox/get-user-credentials";
import { getSandbox } from "@/lib/sandbox/client";
import { resolveSandboxAiAccess } from "@/lib/sandbox/ai-runtime";
import { resolveSandboxRecordContext } from "@/lib/sandbox/context";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteContext,
} from "@/lib/sandbox/route-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { readActiveTeamIdHeader } from "@/lib/team-capabilities";

type CancelSandboxRecord = {
  sandbox_id: string;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id: string | null;
  vercel_project_id: string | null;
  preview_url: string | null;
  repo?: Record<string, unknown> | Record<string, unknown>[] | null;
};

async function loadOwnedSandboxRecord(sandboxId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("sandboxes")
    .select(
      "sandbox_id, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, preview_url, repo:repos(id)"
    )
    .eq("id", sandboxId)
    .eq("user_id", userId)
    .single();
  return (data as CancelSandboxRecord | null) ?? null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let creds;
  try {
    creds = await getSandboxServiceCredentials(request, {
      allowInternal: true,
      teamId: readActiveTeamIdHeader(request),
      requireCapability: "tools.bash",
    });
  } catch (error) {
    if (isSandboxCapabilityDeniedError(error)) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    throw error;
  }
  if (!creds) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const cmdId = typeof body?.cmdId === "string" ? body.cmdId.trim() : "";
  if (!cmdId) {
    return NextResponse.json({ error: "cmdId required" }, { status: 400 });
  }

  const sandboxData = await loadOwnedSandboxRouteContext<CancelSandboxRecord>(
    request,
    id,
    {
      select:
        "sandbox_id, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, preview_url, repo:repos(id)",
      includeAi: false,
    },
    {
      getSandboxServiceCredentials: async () => creds,
      loadOwnedSandboxRecord,
      getSandbox,
      resolveSandboxRecordContext: (input) =>
        resolveSandboxRecordContext(input, { resolveSandboxAiAccess }),
    }
  );

  if (!sandboxData.ok) return buildSandboxRouteErrorResponse(sandboxData);
  if (!sandboxData.sandbox) {
    return NextResponse.json(
      { error: "Sandbox is not ready" },
      { status: 409 }
    );
  }

  try {
    const cmd = await sandboxData.sandbox.getCommand(cmdId);
    await cmd.kill("SIGINT");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cancel failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
