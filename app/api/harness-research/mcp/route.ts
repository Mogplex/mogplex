import { createResearchMcpPost } from "@/lib/harness/research-mcp";
import { loadOwnedAiCall } from "@/lib/interactive-runs";
import { isActiveResearchRun } from "@/lib/harness/research-auth";
import {
  ALL_CAPABILITIES,
  resolveMemberCapabilities,
} from "@/lib/team-capabilities";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = createResearchMcpPost({
  async authorizeRun(claims) {
    const run = await loadOwnedAiCall(claims.userId, claims.aiCallId);
    if (!isActiveResearchRun(run, claims)) return null;
    const teamId = run.metadata?.product_team_id;
    return typeof teamId === "string"
      ? resolveMemberCapabilities(claims.userId, teamId)
      : ALL_CAPABILITIES;
  },
});
