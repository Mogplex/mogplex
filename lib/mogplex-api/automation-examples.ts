import type { FlowGraph } from "@/lib/types";

export const scheduledTaskExample: FlowGraph = {
  nodes: [
    {
      id: "start",
      type: "start",
      position: { x: 0, y: 0 },
      data: {
        label: "Daily",
        event: "schedule",
        scheduleCron: "10 7 * * *",
        scheduleTimezone: "UTC",
        filter: { scope: "org", installationIds: [123], repos: ["owner/repo"] },
      },
    },
    {
      id: "task",
      type: "agent",
      position: { x: 300, y: 0 },
      data: {
        label: "Repository task",
        role: "task",
        harness: "mogplex",
        agentId: "REPLACE_WITH_AGENT_ID",
        modelOverride: null,
        systemPromptOverride:
          "Inspect the repository for the requested maintenance. Check open PRs first. Apply only needed changes, run the repository checks, and open a PR for human review. If no change is needed, report NO_ACTION.",
        autoMerge: false,
        autofix: false,
        autoRevert: false,
        requireApproval: false,
      },
    },
    {
      id: "end",
      type: "end",
      position: { x: 600, y: 0 },
      data: { label: "Done" },
    },
  ],
  edges: [
    { id: "start-task", source: "start", target: "task" },
    { id: "task-end", source: "task", target: "end" },
  ],
};

export function oneTimeTaskExample(scheduled: FlowGraph): FlowGraph {
  return {
    ...scheduled,
    nodes: scheduled.nodes.map((node) =>
      node.type === "start"
        ? {
            ...node,
            data: {
              label: "Run once",
              event: "schedule",
              scheduleRunAt: "2027-01-15T15:00:00-05:00",
              filter: node.data.filter,
            },
          }
        : node
    ),
  };
}
