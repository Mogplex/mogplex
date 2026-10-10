import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { loadModelSettingsTargets } from "@/lib/models/settings-defaults";
import { isModelSurface } from "@/lib/models/surface-defaults";
import { canUserSetDefaultModel } from "@/lib/models/default-model";
import { supabaseAdmin } from "@/lib/supabase/admin";

const defaultDeps = { requireUserId, loadModelSettingsTargets };
export function createModelTargetsGetHandler(deps = defaultDeps) {
  return async function GET() {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    try {
      return NextResponse.json(await deps.loadModelSettingsTargets(userId));
    } catch {
      return NextResponse.json(
        { error: "Unable to load model destinations" },
        { status: 500 }
      );
    }
  };
}
export const GET = createModelTargetsGetHandler();

export function createModelTargetsPatchHandler(
  overrides: { requireUserId?: typeof requireUserId } = {}
) {
  const authenticate = overrides.requireUserId ?? requireUserId;
  return async function PATCH(request: Request) {
    const userId = await authenticate();
    if (userId instanceof Response) return userId;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return NextResponse.json(
        { error: "Invalid surface model" },
        { status: 400 }
      );
    const { surface, model } = body as Record<string, unknown>;
    if (
      !isModelSurface(surface) ||
      (model !== null && (typeof model !== "string" || !model.trim()))
    )
      return NextResponse.json(
        { error: "Choose a surface and model, or follow primary" },
        { status: 400 }
      );
    try {
      if (model !== null && !(await canUserSetDefaultModel(userId, model)))
        return NextResponse.json(
          { error: "Model must be enabled and available" },
          { status: 400 }
        );
      const { data, error } = await supabaseAdmin.rpc("set_surface_model", {
        p_user_id: userId,
        p_surface: surface,
        p_model: model,
      });
      if (error || !data) throw new Error("Save failed");
      return NextResponse.json(data);
    } catch {
      return NextResponse.json(
        { error: "Unable to save surface model. No changes were applied." },
        { status: 500 }
      );
    }
  };
}
export const PATCH = createModelTargetsPatchHandler();
