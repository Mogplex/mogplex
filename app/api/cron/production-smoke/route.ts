import { NextResponse } from "next/server";
import { requireMachineApiAuth } from "@/lib/internal-api-auth";
import { runProductionSmokeChecks } from "@/lib/production-smoke";
import type { ProductionSmokeSummary } from "@/lib/production-smoke";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type ProductionSmokeRouteDeps = {
  requireMachineApiAuth: typeof requireMachineApiAuth;
  runProductionSmokeChecks: () => Promise<ProductionSmokeSummary>;
};

const defaultDeps: ProductionSmokeRouteDeps = {
  requireMachineApiAuth,
  runProductionSmokeChecks,
};

export function createProductionSmokeGetHandler(
  overrides: Partial<ProductionSmokeRouteDeps> = {}
) {
  const deps: ProductionSmokeRouteDeps = {
    ...defaultDeps,
    ...overrides,
  };

  return async function GET(req: Request) {
    const authResponse = deps.requireMachineApiAuth(
      req,
      "/api/cron/production-smoke"
    );
    if (authResponse) return authResponse;

    const summary = await deps.runProductionSmokeChecks();
    if (!summary.ok) {
      return NextResponse.json(summary, { status: 500 });
    }

    return NextResponse.json(summary);
  };
}

export const GET = createProductionSmokeGetHandler();
