import {
  CLASSIFY_UNCERTAIN_HANDLE_ID,
  FAILURE_HANDLE_ID,
} from "@/lib/flows/graph-helpers";
import { classifyAnswerHandles } from "@/lib/flows/operators/classify";
import type { FlowClassifyNodeData } from "@/lib/types";

export type ClassifyBranchRow = {
  handleId: string | null;
  label: string;
  tone: "answer" | "uncertain" | "error";
};

export function classifyKindLabel(output: FlowClassifyNodeData["output"]) {
  if (output.kind === "choice") return "Single choice";
  if (output.kind === "scale") return `Scale 1 to ${output.levels.length}`;
  return "True / false";
}

/** One row per outgoing branch, top to bottom, ending with the error branch. */
export function classifyBranchRows(
  data: FlowClassifyNodeData
): ClassifyBranchRow[] {
  const { output } = data;
  const handles = classifyAnswerHandles(output);
  const answers: ClassifyBranchRow[] =
    output.kind === "boolean"
      ? [
          { handleId: handles[0], label: "True", tone: "answer" },
          { handleId: handles[1], label: "False", tone: "answer" },
        ]
      : output.kind === "choice"
        ? output.options.map((option, index) => ({
            handleId: handles[index],
            label: option.label || "Unnamed option",
            tone: "answer" as const,
          }))
        : [{ handleId: null, label: "Score", tone: "answer" }];
  return [
    ...answers,
    ...(data.minConfidence == null
      ? []
      : [
          {
            handleId: CLASSIFY_UNCERTAIN_HANDLE_ID,
            label: "Uncertain",
            tone: "uncertain" as const,
          },
        ]),
    { handleId: FAILURE_HANDLE_ID, label: "On error", tone: "error" },
  ];
}

/**
 * Drop edges that leave a classify node through a branch it no longer has,
 * for example after an option is removed or the answer type changes. Without
 * this the canvas cannot draw the edge, so the author could never delete it.
 */
export function pruneClassifyEdges<
  TEdge extends { source: string; sourceHandle?: string | null },
>(nodeId: string, data: FlowClassifyNodeData, edges: TEdge[]): TEdge[] {
  const live = new Set(classifyBranchRows(data).map((row) => row.handleId));
  return edges.filter(
    (edge) => edge.source !== nodeId || live.has(edge.sourceHandle ?? null)
  );
}
