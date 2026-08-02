import { NextResponse } from "next/server";
import { hasPlaywrightAuthBypass } from "@/lib/internal-api-auth";
import {
  resetFlowsE2ETestState,
  snapshotFlowsE2ETestState,
} from "@/lib/flows/test-store";
import type { FlowsE2ETestState } from "@/lib/flows/test-store";

function ensurePlaywrightAccess(request: Request) {
  if (process.env.PLAYWRIGHT !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!hasPlaywrightAuthBypass(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

export async function GET(request: Request) {
  const denial = ensurePlaywrightAccess(request);
  if (denial) return denial;

  return NextResponse.json(snapshotFlowsE2ETestState());
}

export async function POST(request: Request) {
  const denial = ensurePlaywrightAccess(request);
  if (denial) return denial;

  const body = await request.json().catch(() => ({}));
  const state = resetFlowsE2ETestState(
    (body?.state || body) as Partial<FlowsE2ETestState>
  );
  return NextResponse.json(state);
}

export async function DELETE(request: Request) {
  const denial = ensurePlaywrightAccess(request);
  if (denial) return denial;

  const state = resetFlowsE2ETestState();
  return NextResponse.json(state);
}
