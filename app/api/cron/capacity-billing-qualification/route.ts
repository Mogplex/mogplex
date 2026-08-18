import { NextResponse } from "next/server";
import {
  runCapacityBillingQualification,
  type CapacityBillingQualification,
} from "@/lib/billing/capacity-qualification";
import { getNeonPool } from "@/lib/db/pool";
import { requireMachineApiAuth } from "@/lib/internal-api-auth";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type CapacityQualificationRouteDeps = {
  requireMachineApiAuth: typeof requireMachineApiAuth;
  runQualification: () => Promise<CapacityBillingQualification>;
};

const defaultDeps: CapacityQualificationRouteDeps = {
  requireMachineApiAuth,
  runQualification: () => runCapacityBillingQualification(getNeonPool()),
};

export function createCapacityQualificationGetHandler(
  overrides: Partial<CapacityQualificationRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function GET(request: Request) {
    const authResponse = deps.requireMachineApiAuth(
      request,
      "/api/cron/capacity-billing-qualification"
    );
    if (authResponse) return authResponse;

    try {
      const summary = await deps.runQualification();
      return NextResponse.json(summary, { status: summary.ok ? 200 : 409 });
    } catch (error) {
      console.error("[capacity-billing-qualification] failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json(
        { ok: false, error: "Capacity billing qualification unavailable" },
        { status: 500 }
      );
    }
  };
}

export const GET = createCapacityQualificationGetHandler();
