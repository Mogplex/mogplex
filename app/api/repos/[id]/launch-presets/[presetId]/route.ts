import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { deleteSandboxLaunchPreset } from "@/lib/launch-presets/server";
import { ensureOwnedRepo } from "@/lib/repo-auth";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; presetId: string }> }
) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { id, presetId } = await params;
  const owned = await ensureOwnedRepo(id, userId);
  if (!owned) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  try {
    const { deleted } = await deleteSandboxLaunchPreset({
      userId,
      repoId: id,
      presetId,
    });
    if (!deleted) {
      return NextResponse.json({ error: "Preset not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Log full error server-side; client gets a generic message so
    // Supabase internals don't leak through HTTP responses.
    console.error("[launch-presets] delete failed", {
      repoId: id,
      userId,
      presetId,
      error,
    });
    return NextResponse.json(
      { error: "Failed to delete launch preset" },
      { status: 500 }
    );
  }
}
