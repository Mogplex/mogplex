import { NextResponse } from "next/server";
import { requireMachineApiAuth } from "@/lib/internal-api-auth";
import { withSupabaseAdminConnection } from "@/lib/supabase/admin";
import { runProductionSmokeChecks } from "@/lib/production-smoke";
import type { ProductionSmokeSummary } from "@/lib/production-smoke";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type ProductionSmokeRouteDeps = {
  requireMachineApiAuth: typeof requireMachineApiAuth;
  withSupabaseAdminConnection: typeof withSupabaseAdminConnection;
  runProductionSmokeChecks: (
    client: SupabaseClient
  ) => Promise<ProductionSmokeSummary>;
};

const defaultDeps: ProductionSmokeRouteDeps = {
  requireMachineApiAuth,
  withSupabaseAdminConnection,
  runProductionSmokeChecks: (client) => runProductionSmokeChecks({}, client),
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

    try {
      return await deps.withSupabaseAdminConnection(async (adminClient) => {
        const summary = await deps.runProductionSmokeChecks(adminClient);
        if (!summary.ok) {
          return NextResponse.json(summary, { status: 500 });
        }

        return NextResponse.json(summary);
      });
    } catch (error) {
      console.error("[production-smoke] admin connection run failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json(
        { ok: false, error: "Production smoke unavailable" },
        { status: 500 }
      );
    }
  };
}

export const GET = createProductionSmokeGetHandler();
