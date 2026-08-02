import { NextResponse } from "next/server";
import { getRepoConnectionsForDisplay } from "@/lib/connections/service";
import { requireUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logConnectionEvent } from "@/lib/connections/logging";
import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

async function verifyRepoOwnership(repoId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("repos")
    .select("id")
    .eq("id", repoId)
    .eq("user_id", userId)
    .maybeSingle();

  return Boolean(data?.id);
}

/** Display connections for a repo: all global + repo project connections, plus overrides. */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id: repoId } = await ctx.params;
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const ownsRepo = await verifyRepoOwnership(repoId, userId);
  if (!ownsRepo)
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  try {
    const { connections, overrides, resolvedMcpCount } =
      await getRepoConnectionsForDisplay(userId, repoId);
    return NextResponse.json({
      connections,
      overrides,
      resolved_mcp_count: resolvedMcpCount,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Exclude/include a global connection for this repo, or add a project-specific connection */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: repoId } = await ctx.params;
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  // Verify repo ownership
  const ownsRepo = await verifyRepoOwnership(repoId, userId);
  if (!ownsRepo)
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const body = await req.json();

  // Toggle exclude/include for a global connection
  if (body.connection_id && typeof body.excluded === "boolean") {
    const { data: connection } = await supabaseAdmin
      .from("connections")
      .select("id, user_id, scope")
      .eq("id", body.connection_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (connection?.scope !== "global") {
      return NextResponse.json(
        { error: "Global connection not found" },
        { status: 404 }
      );
    }

    if (body.excluded) {
      const { error } = await supabaseAdmin
        .from("repo_connection_overrides")
        .upsert(
          {
            repo_id: repoId,
            connection_id: body.connection_id,
            excluded: true,
          },
          { onConflict: "repo_id,connection_id" }
        );
      if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { error } = await supabaseAdmin
        .from("repo_connection_overrides")
        .delete()
        .eq("repo_id", repoId)
        .eq("connection_id", body.connection_id);
      if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    logConnectionEvent("connection_override_changed", {
      userId,
      repoId,
      connectionId: body.connection_id,
      reason: body.excluded ? "excluded" : "included",
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "connection_id + excluded required" },
    { status: 400 }
  );
}

/** Remove an override */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id: repoId } = await ctx.params;
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const ownsRepo = await verifyRepoOwnership(repoId, userId);
  if (!ownsRepo)
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const overrideId = searchParams.get("overrideId");
  if (!overrideId)
    return NextResponse.json({ error: "overrideId required" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("repo_connection_overrides")
    .delete()
    .eq("id", overrideId)
    .eq("repo_id", repoId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
