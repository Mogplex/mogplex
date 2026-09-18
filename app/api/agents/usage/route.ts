import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { summarizeAgentUsage } from "@/lib/agents/usage";
import {
  listAgentRunsForUsage,
  listPublishedFlowsForUsage,
} from "../_lib/store";

export type AgentsUsageRouteDeps = {
  requireUserId: typeof requireUserId;
  listPublishedFlows: typeof listPublishedFlowsForUsage;
  listAgentRuns: typeof listAgentRunsForUsage;
};

const defaultDeps: AgentsUsageRouteDeps = {
  requireUserId,
  listPublishedFlows: listPublishedFlowsForUsage,
  listAgentRuns: listAgentRunsForUsage,
};

/**
 * Where each roster agent is used: the caller's published automations that
 * bind it and the caller's runs that recorded it. Keyed by agent id, presets
 * included under their `preset:` ids.
 */
export function createAgentsUsageGetHandler(
  overrides: Partial<AgentsUsageRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function GET() {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    try {
      const [flows, runs] = await Promise.all([
        deps.listPublishedFlows(userId),
        deps.listAgentRuns(userId),
      ]);
      return NextResponse.json(summarizeAgentUsage({ flows, runs }));
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed" },
        { status: 500 }
      );
    }
  };
}

export const GET = createAgentsUsageGetHandler();
