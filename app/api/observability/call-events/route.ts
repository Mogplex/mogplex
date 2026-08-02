import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { loadOwnedAiCall, loadOwnedAiCallEvents } from "@/lib/interactive-runs";
import type { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const aiCallId = req.nextUrl.searchParams.get("ai_call_id");
  if (!aiCallId) {
    return NextResponse.json({ error: "Missing ai_call_id" }, { status: 400 });
  }

  const aiCall = await loadOwnedAiCall(userId, aiCallId);
  if (!aiCall) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  const events = await loadOwnedAiCallEvents(userId, aiCallId);
  return NextResponse.json({ events });
}
