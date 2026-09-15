import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { loadModelSettingsTargets } from "@/lib/models/settings-defaults";

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
