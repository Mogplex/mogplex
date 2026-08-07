import { createFlowDraftSnapshot } from "../../../lib/flows/editor";

export function makeDraft() {
  return createFlowDraftSnapshot({
    name: "Review Flow",
    description: "Flow description",
    notes: "Flow notes",
    draft_graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 0, y: 0 },
          data: { label: "PR opened", event: "pr_opened" },
        },
        {
          id: "agent-a",
          type: "agent",
          position: { x: 200, y: 0 },
          data: { label: "Reviewer A", agentId: "agent-a" },
        },
        {
          id: "agent-b",
          type: "agent",
          position: { x: 420, y: 0 },
          data: { label: "Reviewer B", agentId: "agent-b" },
        },
        {
          id: "end",
          type: "end",
          position: { x: 640, y: 0 },
          data: { label: "Done" },
        },
      ],
      edges: [
        { id: "edge-start-a", source: "start", target: "agent-a" },
        { id: "edge-a-b", source: "agent-a", target: "agent-b" },
        { id: "edge-b-end", source: "agent-b", target: "end" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
}
