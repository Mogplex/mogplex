import { getStartConfig } from "@/lib/flows/graph";
import { coerceGraph } from "@/lib/flows/graph-coerce";
import type { RepoAutomation } from "@/lib/settings/owner-automations";
import type { Flow } from "@/lib/types";

/**
 * Active GitHub-triggered automations with a published graph: the ones the
 * webhook router can start for a repository event.
 */
export function githubAutomations(
  flows: Array<
    Pick<Flow, "id" | "name" | "status" | "source_kind"> & {
      published_version?: { graph?: unknown } | null;
    }
  >
): RepoAutomation[] {
  const automations: RepoAutomation[] = [];
  for (const flow of flows) {
    if (flow.status !== "active" || flow.source_kind !== "github") continue;
    const graph = flow.published_version?.graph;
    if (!graph) continue;
    const start = getStartConfig(coerceGraph(graph));
    if (!start) continue;
    automations.push({ id: flow.id, name: flow.name, filter: start.filter });
  }
  return automations;
}
