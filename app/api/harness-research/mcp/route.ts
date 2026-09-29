import { createMogplexMcpPost } from "@/lib/harness/mogplex-mcp";
import { harnessToolRunFromCall } from "@/lib/harness/mogplex-tools";
import { loadOwnedAiCall } from "@/lib/interactive-runs";
import { isActiveResearchRun } from "@/lib/harness/research-auth";
import {
  ALL_CAPABILITIES,
  resolveMemberCapabilities,
} from "@/lib/team-capabilities";

export const runtime = "nodejs";
// Connection and GitHub tools run here for the harness, not only search.
export const maxDuration = 300;

export const POST = createMogplexMcpPost({
  async authorizeRun(claims) {
    const call = await loadOwnedAiCall(claims.userId, claims.aiCallId);
    if (!isActiveResearchRun(call, claims)) return null;
    const run = harnessToolRunFromCall(claims, call);
    const capabilities = run.teamId
      ? await resolveMemberCapabilities(claims.userId, run.teamId)
      : ALL_CAPABILITIES;
    return { run, capabilities };
  },
});
