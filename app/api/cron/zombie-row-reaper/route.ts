import { NextResponse } from "next/server";
import { requireMachineApiAuth } from "@/lib/internal-api-auth";
import {
  buildZombieReaperResponse,
  createZombieReaperRunner,
  ZombieReaperRunError,
} from "@/lib/zombies/zombie-reaper";
import type { ZombieReaperRunnerDeps } from "@/lib/zombies/zombie-reaper";

type ZombieReaperGetHandlerOverrides = Partial<ZombieReaperRunnerDeps> & {
  requireMachineApiAuth?: typeof requireMachineApiAuth;
};

export function createZombieReaperGetHandler(
  overrides: ZombieReaperGetHandlerOverrides = {}
) {
  const {
    requireMachineApiAuth: auth = requireMachineApiAuth,
    ...runnerOverrides
  } = overrides;
  const runZombieReaper = createZombieReaperRunner(runnerOverrides);

  return async function GET(req: Request) {
    const authResponse = auth(req, "/api/cron/zombie-row-reaper");
    if (authResponse) return authResponse;

    try {
      const summary = await runZombieReaper();
      return NextResponse.json(buildZombieReaperResponse(summary));
    } catch (error) {
      if (error instanceof ZombieReaperRunError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status }
        );
      }
      throw error;
    }
  };
}

export const GET = createZombieReaperGetHandler();
