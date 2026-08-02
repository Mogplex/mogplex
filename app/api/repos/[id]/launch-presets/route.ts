import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  listSandboxLaunchPresets,
  upsertSandboxLaunchPreset,
} from "@/lib/launch-presets/server";
import {
  normalizeSandboxLaunchPresetInput,
  SandboxLaunchPresetValidationError,
} from "@/lib/launch-presets/shared";
import { ensureOwnedRepo } from "@/lib/repo-auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { id } = await params;

  const owned = await ensureOwnedRepo(id, userId);
  if (!owned) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  try {
    const presets = await listSandboxLaunchPresets(userId, id);
    return NextResponse.json({ presets });
  } catch (error) {
    // Log the full Supabase error server-side; surface a generic
    // message to the client so column names, constraint names, or
    // partial query text in error.message can't leak.
    console.error("[launch-presets] list failed", {
      repoId: id,
      userId,
      error,
    });
    return NextResponse.json(
      { error: "Failed to load launch presets" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { id } = await params;
  const owned = await ensureOwnedRepo(id, userId);
  if (!owned) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let normalized;
  try {
    normalized = normalizeSandboxLaunchPresetInput(payload);
  } catch (error) {
    if (error instanceof SandboxLaunchPresetValidationError) {
      return NextResponse.json(
        { error: error.message, field: error.field },
        { status: 400 }
      );
    }
    throw error;
  }

  try {
    const preset = await upsertSandboxLaunchPreset({
      userId,
      repoId: id,
      preset: normalized,
    });
    return NextResponse.json({ preset });
  } catch (error) {
    if (error instanceof SandboxLaunchPresetValidationError) {
      return NextResponse.json(
        { error: error.message, field: error.field },
        { status: 400 }
      );
    }
    console.error("[launch-presets] save failed", {
      repoId: id,
      userId,
      error,
    });
    return NextResponse.json(
      { error: "Failed to save launch preset" },
      { status: 500 }
    );
  }
}
