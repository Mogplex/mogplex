/**
 * Runtime boundary for classify nodes: binds a flow run's owner, repo, and
 * identifiers onto the decision layer's classify entry point.
 */

import { classify } from "@/lib/decisions/classify";
import type { FlowOperatorClassifier } from "@/lib/flows/operators/types";
import type { JobContext } from "@/lib/workflows/automation-job-types";

export type FlowNodeClassifier = (
  input: Parameters<FlowOperatorClassifier>[0] & {
    context: JobContext;
    flowId: string;
    flowVersionId: string | null;
  }
) => ReturnType<FlowOperatorClassifier>;

function metadataTeamId(metadata: Record<string, unknown>): string | null {
  for (const key of ["product_team_id", "team_id"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Build the classifier a flow run uses. Tests pass their own `run`. */
export function createFlowNodeClassifier(
  run: typeof classify = classify
): FlowNodeClassifier {
  return (input) =>
    run({
      question: input.question,
      output: input.output,
      state: input.state,
      minConfidence: input.minConfidence,
      scope: {
        surface: "automation",
        userId: input.context.repo.user_id,
        teamId: metadataTeamId(input.context.metadata),
        repoId: input.context.repo.id,
      },
      metadata: {
        flow_id: input.flowId,
        flow_version_id: input.flowVersionId,
        job_run_id: input.jobRunId,
        flow_node_id: input.nodeId,
        flow_node_label: input.nodeLabel,
      },
    });
}

export const classifyFlowNode = createFlowNodeClassifier();
