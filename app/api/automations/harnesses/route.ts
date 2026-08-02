import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  buildSandboxHarnessAiEnv,
  resolveSandboxAiAccess,
} from "@/lib/sandbox/ai-runtime";
import type { HarnessId } from "@/lib/harness/config";

type AutomationHarnessesDeps = {
  requireUserId: typeof requireUserId;
  resolveSandboxAiAccess: typeof resolveSandboxAiAccess;
};

const defaultAutomationHarnessesDeps: AutomationHarnessesDeps = {
  requireUserId,
  resolveSandboxAiAccess,
};

export function createAutomationHarnessesGetHandler(
  overrides: Partial<AutomationHarnessesDeps> = {}
) {
  const deps = {
    ...defaultAutomationHarnessesDeps,
    ...overrides,
  };

  return async function GET() {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const access = await deps.resolveSandboxAiAccess(userId);
    const availability = (["claude-code", "codex"] as const).map(
      (harnessId: HarnessId) => {
        const resolution = buildSandboxHarnessAiEnv(access, harnessId);
        return [
          harnessId,
          resolution.ok
            ? {
                available: true,
                billingSource: resolution.aiBillingSource,
                reason: null,
              }
            : {
                available: false,
                billingSource: null,
                reason: resolution.error,
              },
        ] as const;
      }
    );

    return NextResponse.json({
      harnesses: {
        mogplex: {
          available: true,
          billingSource: "mogplex",
          reason: null,
        },
        ...Object.fromEntries(availability),
      },
    });
  };
}

export const GET = createAutomationHarnessesGetHandler();
