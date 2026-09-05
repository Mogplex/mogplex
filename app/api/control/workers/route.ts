import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { loadControlWorkers } from "@/lib/control/workers-data";

export function createControlWorkersGetHandler(
  overrides: Partial<{
    requireUserId: typeof requireUserId;
    loadWorkers: typeof loadControlWorkers;
  }> = {}
) {
  const deps = { requireUserId, loadWorkers: loadControlWorkers, ...overrides };
  return async function GET(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const sessionId = new URL(request.url).searchParams
      .get("sessionId")
      ?.trim();
    if (!sessionId)
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    try {
      const workers = await deps.loadWorkers(userId, sessionId);
      if (!workers)
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 }
        );
      return NextResponse.json({ workers });
    } catch (error) {
      console.error("[control/workers] read failed", error);
      return NextResponse.json(
        { error: "Could not load worker status. Try again." },
        { status: 500 }
      );
    }
  };
}

export const GET = createControlWorkersGetHandler();
