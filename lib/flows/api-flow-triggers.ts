import {
  isFlowsE2ETestMode,
  listOwnedFlowsWithSummaries as listOwnedFlowsWithSummariesTest,
} from "@/lib/flows/test-store";
import { unwrapRowsOrThrow } from "@/lib/flows/supabase-result";
import {
  githubAutomations,
  type RepoAutomation,
} from "@/lib/settings/owner-automations";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The user's GitHub-triggered automations with each one's start filter, for
 * Settings → Repositories. Reads only the flow columns and published graphs
 * it needs, none of the run and dispatch summaries `GET /api/flows` builds.
 */
export async function listGithubAutomationTriggers(
  userId: string
): Promise<RepoAutomation[]> {
  if (isFlowsE2ETestMode()) {
    return githubAutomations(await listOwnedFlowsWithSummariesTest(userId));
  }

  const flows = unwrapRowsOrThrow(
    await supabaseAdmin
      .from("flows")
      .select("id, name, status, source_kind, published_version_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .eq("source_kind", "github")
      .order("created_at", { ascending: false })
  );
  const versionIds = flows
    .map((flow) => flow.published_version_id)
    .filter((id): id is string => typeof id === "string");
  if (versionIds.length === 0) return [];

  const versions = unwrapRowsOrThrow(
    await supabaseAdmin
      .from("flow_versions")
      .select("id, graph")
      .in("id", versionIds)
  );
  const graphs = new Map(versions.map((version) => [version.id, version]));
  return githubAutomations(
    flows.map((flow) => ({
      ...flow,
      published_version: graphs.get(flow.published_version_id) ?? null,
    }))
  );
}
