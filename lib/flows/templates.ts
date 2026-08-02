import type {
  FlowActionNodeData,
  FlowAgentNodeData,
  FlowGraph,
  PersonalFlowTemplateReconnect,
  FlowStartNodeData,
  TriggerEvent,
} from "@/lib/types";
import { eventLabel } from "@/lib/flows/graph-helpers";
import { DEFAULT_NEW_AGENT_MODEL_ID } from "@/lib/agents/model-options";

export type FlowStarterTemplateId =
  | "blank"
  | "pr-review"
  | "dependabot-autopilot"
  | "issue-triage";

export type FlowStarterTemplate = {
  id: FlowStarterTemplateId;
  name: string;
  description: string;
  trigger: string;
};

export const FLOW_STARTER_TEMPLATES: readonly FlowStarterTemplate[] = [
  {
    id: "blank",
    name: "Blank workflow",
    description: "A simple trigger, agent, and completion path.",
    trigger: "@mention",
  },
  {
    id: "pr-review",
    name: "Pull request review",
    description: "Review every newly opened pull request.",
    trigger: "PR opened",
  },
  {
    id: "dependabot-autopilot",
    name: "Dependabot autopilot",
    description: "Review, repair, and merge safe Dependabot updates.",
    trigger: "Dependabot PR",
  },
  {
    id: "issue-triage",
    name: "Issue triage",
    description: "Analyze each new issue and recommend next steps.",
    trigger: "Issue opened",
  },
] as const;

export function isFlowStarterTemplateId(
  value: unknown
): value is FlowStarterTemplateId {
  return FLOW_STARTER_TEMPLATES.some((template) => template.id === value);
}

export function getFlowStarterTemplate(templateId: FlowStarterTemplateId) {
  return FLOW_STARTER_TEMPLATES.find((template) => template.id === templateId)!;
}

export function bindFlowGraphToInstallation(
  graph: FlowGraph,
  installationId: number
): FlowGraph {
  return bindFlowGraphToScope(graph, { installationId });
}

export function bindFlowGraphToScope(
  graph: FlowGraph,
  input: {
    installationId: number;
    repository?: string | null;
  }
): FlowGraph {
  const repository = input.repository?.trim() || null;
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.type === "start"
        ? {
            ...node,
            data: {
              ...node.data,
              filter: {
                scope: node.data.filter?.scope ?? "all",
                ...node.data.filter,
                installationIds: [input.installationId],
                ...(repository
                  ? { repos: [repository] }
                  : { repos: undefined }),
              },
            },
          }
        : node
    ),
  };
}

const REPOSITORY_REQUIRED_TEMPLATE_EVENTS: ReadonlySet<TriggerEvent> = new Set([
  "schedule",
  "webhook",
  "slack_mention",
]);

export function flowTemplateRequiresRepository(graph: FlowGraph) {
  const start = graph.nodes.find((node) => node.type === "start");
  return start
    ? REPOSITORY_REQUIRED_TEMPLATE_EVENTS.has(start.data.event)
    : false;
}

export function getFlowTemplateReconnects(
  graph: FlowGraph
): PersonalFlowTemplateReconnect[] {
  const reconnect = new Set<PersonalFlowTemplateReconnect>();
  for (const node of graph.nodes) {
    if (node.type === "agent" && !node.data.agentId) {
      reconnect.add("agent");
    }
    if (node.type === "start") {
      if (node.data.event === "webhook") reconnect.add("webhook");
      if (node.data.event === "slack_mention") reconnect.add("slack");
    }
    if (
      node.type === "action" &&
      node.data.operation === "slack.send_message"
    ) {
      reconnect.add("slack");
    }
  }
  return Array.from(reconnect);
}

export function sanitizeFlowGraphForPersonalTemplate(
  graph: FlowGraph
): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.type === "start") {
        const {
          installationIds: _installationIds,
          repos: _repos,
          ...filter
        } = node.data.filter ?? { scope: "all" as const };
        const {
          slackTeamId: _slackTeamId,
          slackChannelId: _slackChannelId,
          slackChannelName: _slackChannelName,
          ...data
        } = node.data;
        return {
          ...node,
          data: {
            ...data,
            filter,
          },
        };
      }
      if (
        node.type === "action" &&
        node.data.operation === "slack.send_message"
      ) {
        return {
          ...node,
          data: {
            ...node.data,
            teamId: "",
            channelId: "",
            channelName: null,
          } satisfies FlowActionNodeData,
        };
      }
      return node;
    }),
    edges: graph.edges.map((edge) => ({ ...edge })),
    viewport: graph.viewport ? { ...graph.viewport } : undefined,
  };
}

export function sanitizeFlowGraphForTeamTemplate(graph: FlowGraph): FlowGraph {
  const sanitized = sanitizeFlowGraphForPersonalTemplate(graph);
  return {
    ...sanitized,
    nodes: sanitized.nodes.map((node) =>
      node.type === "agent"
        ? {
            ...node,
            data: {
              ...node.data,
              agentId: null,
            },
          }
        : node
    ),
  };
}

export function preparePersonalFlowTemplateGraphForValidation(
  graph: FlowGraph
): FlowGraph {
  const scoped = bindFlowGraphToScope(graph, {
    installationId: 1,
    repository: flowTemplateRequiresRepository(graph)
      ? "template/repository"
      : null,
  });
  return {
    ...scoped,
    nodes: scoped.nodes.map((node) => {
      if (node.type === "start" && node.data.event === "slack_mention") {
        return {
          ...node,
          data: {
            ...node.data,
            slackTeamId: node.data.slackTeamId || "template-workspace",
            slackChannelId: node.data.slackChannelId || "template-channel",
          },
        };
      }
      if (
        node.type === "action" &&
        node.data.operation === "slack.send_message" &&
        node.data.destination !== "trigger_thread"
      ) {
        return {
          ...node,
          data: {
            ...node.data,
            teamId: node.data.teamId || "template-workspace",
            channelId: node.data.channelId || "template-channel",
          },
        };
      }
      return node;
    }),
  };
}

function createStarterGraph(input: {
  event: TriggerEvent;
  startData?: Partial<FlowStartNodeData>;
  agentId: string | null;
  agentName: string;
  agentData?: Partial<FlowAgentNodeData>;
  modelId?: string | null;
}): FlowGraph {
  return {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 80, y: 140 },
        data: {
          label: eventLabel(input.event),
          event: input.event,
          isDefault: input.event === "mention",
          ...input.startData,
        },
      },
      {
        id: "agent-1",
        type: "agent",
        position: { x: 360, y: 140 },
        data: {
          label: input.agentName,
          agentId: input.agentId,
          harness: "mogplex",
          role: input.event === "issue_opened" ? "triage" : "review",
          // A template has to produce a publishable graph, and publish now
          // requires a model on every mogplex agent node. Prefer the model the
          // caller's scope can actually invoke; the constant is the last resort
          // that keeps the graph publishable when nothing resolved.
          modelOverride: input.modelId?.trim() || DEFAULT_NEW_AGENT_MODEL_ID,
          maxStepsOverride: null,
          timeoutMsOverride: null,
          systemPromptOverride: null,
          ...input.agentData,
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 640, y: 140 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "start-agent-1", source: "start", target: "agent-1" },
      { id: "agent-1-end", source: "agent-1", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function buildFlowStarterTemplateGraph(input: {
  templateId: FlowStarterTemplateId;
  agentId: string | null;
  agentName: string;
  modelId?: string | null;
}): FlowGraph {
  switch (input.templateId) {
    case "pr-review":
      return createStarterGraph({
        event: "pr_opened",
        agentId: input.agentId,
        agentName: input.agentName,
        modelId: input.modelId,
      });
    case "dependabot-autopilot":
      return createStarterGraph({
        event: "pr_opened",
        startData: {
          filter: {
            scope: "all",
            authorFilter: "dependabot_only",
          },
        },
        agentId: input.agentId,
        agentName: input.agentName,
        modelId: input.modelId,
        agentData: {
          autofix: true,
          autofixSandbox: true,
          autoMerge: true,
        },
      });
    case "issue-triage":
      return createStarterGraph({
        event: "issue_opened",
        agentId: input.agentId,
        agentName: input.agentName,
        modelId: input.modelId,
      });
    case "blank":
      return createStarterGraph({
        event: "mention",
        agentId: input.agentId,
        agentName: input.agentName,
        modelId: input.modelId,
      });
  }
}
