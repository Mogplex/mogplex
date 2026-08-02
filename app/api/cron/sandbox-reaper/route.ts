import { NextResponse } from "next/server";
import { requireMachineApiAuth } from "@/lib/internal-api-auth";
import {
  buildSandboxReaperResponse,
  createSandboxReaperRunner,
  SandboxReaperRunError,
} from "@/lib/sandbox/reaper";
import type { SandboxReaperRunnerDeps } from "@/lib/sandbox/reaper";

type SandboxReaperGetHandlerOverrides = Partial<SandboxReaperRunnerDeps> & {
  requireMachineApiAuth?: typeof requireMachineApiAuth;
};

export function createSandboxReaperGetHandler(
  overrides: SandboxReaperGetHandlerOverrides = {}
) {
  const {
    requireMachineApiAuth: auth = requireMachineApiAuth,
    ...runnerOverrides
  } = overrides;
  const runSandboxReaper = createSandboxReaperRunner(runnerOverrides);

  return async function GET(req: Request) {
    const authResponse = auth(req, "/api/cron/sandbox-reaper");
    if (authResponse) return authResponse;

    try {
      const summary = await runSandboxReaper();
      return NextResponse.json(buildSandboxReaperResponse(summary));
    } catch (error) {
      if (error instanceof SandboxReaperRunError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status }
        );
      }

      throw error;
    }
  };
}

export const GET = createSandboxReaperGetHandler();
export { stopSandbox } from "@/lib/sandbox/reaper";
