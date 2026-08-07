import { useMemo } from "react";
import {
  draftToGraph,
  type FlowCanvasNode,
  type FlowDraftSnapshot,
} from "@/lib/flows/editor";
import { getStartConfig } from "@/lib/flows/graph";
import type { Flow, FlowAgentHarness, FlowNode, Agent } from "@/lib/types";
import { scopedHref } from "@/lib/scoped-href";
import type { Installation, SlackInstallation } from "./types";

export interface FlowDerivedSelectionParams {
  draft: FlowDraftSnapshot | null;
  selectedFlow: Flow | null | undefined;
  agents: Agent[] | undefined;
  installations: Installation[] | undefined;
  slackInstallationsResponse:
    | { installations: SlackInstallation[] }
    | undefined;
  scope: string | undefined;
}

export interface FlowDerivedSelectionResult {
  selectedNode: FlowCanvasNode | null;
  selectedAgentDefinition: Agent | null;
  selectedStartNode:
    | (FlowCanvasNode & { data: Extract<FlowNode, { type: "start" }>["data"] })
    | null;
  selectedStartConfig: ReturnType<typeof getStartConfig> | null;
  scopedInstallationIds: number[] | undefined;
  effectiveInstallationId: number | null;
  selectedFlowInstallation: Installation | null;
  selectedAgentNode:
    | (FlowCanvasNode & { data: Extract<FlowNode, { type: "agent" }>["data"] })
    | null;
  selectedActionNode:
    | (FlowCanvasNode & { data: Extract<FlowNode, { type: "action" }>["data"] })
    | null;
  selectedSlackTeamId: string;
  slackInstallations: SlackInstallation[];
  slackConnectionsHref: string;
  selectedAgentHarness: FlowAgentHarness;
  apiKeysSettingsHref: string;
  selectedConditionNode:
    | (FlowCanvasNode & {
        data: Extract<FlowNode, { type: "condition" }>["data"];
      })
    | null;
  selectedParallelNode:
    | (FlowCanvasNode & {
        data: Extract<FlowNode, { type: "parallel" }>["data"];
      })
    | null;
  selectedJoinNode:
    | (FlowCanvasNode & { data: Extract<FlowNode, { type: "join" }>["data"] })
    | null;
  selectedDelayNode:
    | (FlowCanvasNode & { data: Extract<FlowNode, { type: "delay" }>["data"] })
    | null;
  selectedAwaitEventNode:
    | (FlowCanvasNode & {
        data: Extract<FlowNode, { type: "await_event" }>["data"];
      })
    | null;
  selectedSetVariableNode:
    | (FlowCanvasNode & {
        data: Extract<FlowNode, { type: "set_variable" }>["data"];
      })
    | null;
  selectedTransformNode:
    | (FlowCanvasNode & {
        data: Extract<FlowNode, { type: "transform" }>["data"];
      })
    | null;
  selectedEndNode:
    | (FlowCanvasNode & { data: Extract<FlowNode, { type: "end" }>["data"] })
    | null;
}

export function useFlowDerivedSelection(
  params: FlowDerivedSelectionParams
): FlowDerivedSelectionResult {
  const {
    draft,
    selectedFlow,
    agents,
    installations,
    slackInstallationsResponse,
    scope,
  } = params;

  const selectedNode = useMemo(
    () =>
      draft?.nodes.find(
        (node: FlowCanvasNode) => node.id === draft.selectedNodeId
      ) || null,
    [draft]
  );

  const selectedAgentDefinition = useMemo(
    () =>
      selectedNode?.type === "agent"
        ? (agents || []).find(
            (agent) => agent.id === selectedNode.data.agentId
          ) || null
        : null,
    [agents, selectedNode]
  );

  const selectedStartNode =
    selectedNode?.type === "start"
      ? (selectedNode as FlowCanvasNode & {
          data: Extract<FlowNode, { type: "start" }>["data"];
        })
      : null;

  const selectedStartConfig = useMemo(
    () => (draft ? getStartConfig(draftToGraph(draft)) : null),
    [draft]
  );

  const scopedInstallationIds = selectedStartConfig?.filter?.installationIds;

  const effectiveInstallationId =
    scopedInstallationIds?.length === 1
      ? scopedInstallationIds[0]
      : (selectedFlow?.installation_id ?? null);

  const selectedFlowInstallation =
    (installations || []).find(
      (installation) => installation.installation_id === effectiveInstallationId
    ) ?? null;

  const selectedAgentNode =
    selectedNode?.type === "agent"
      ? (selectedNode as FlowCanvasNode & {
          data: Extract<FlowNode, { type: "agent" }>["data"];
        })
      : null;

  const selectedActionNode =
    selectedNode?.type === "action"
      ? (selectedNode as FlowCanvasNode & {
          data: Extract<FlowNode, { type: "action" }>["data"];
        })
      : null;

  const selectedSlackTeamId =
    selectedActionNode?.data.operation === "slack.send_message" &&
    selectedActionNode.data.destination !== "trigger_thread"
      ? selectedActionNode.data.teamId
      : selectedStartNode?.data.event === "slack_mention"
        ? (selectedStartNode.data.slackTeamId ?? "")
        : "";

  const slackInstallations = slackInstallationsResponse?.installations ?? [];

  const slackConnectionsHref = scope
    ? scopedHref(scope, "/settings?tab=connections")
    : "/settings?tab=connections";

  const selectedAgentHarness: FlowAgentHarness =
    selectedAgentNode?.data.harness ?? "mogplex";

  const apiKeysSettingsHref = scope
    ? scopedHref(scope, "/settings?tab=keys")
    : "/settings?tab=keys";

  const selectedConditionNode =
    selectedNode?.type === "condition"
      ? (selectedNode as FlowCanvasNode & {
          data: Extract<FlowNode, { type: "condition" }>["data"];
        })
      : null;

  const selectedParallelNode =
    selectedNode?.type === "parallel"
      ? (selectedNode as FlowCanvasNode & {
          data: Extract<FlowNode, { type: "parallel" }>["data"];
        })
      : null;

  const selectedJoinNode =
    selectedNode?.type === "join"
      ? (selectedNode as FlowCanvasNode & {
          data: Extract<FlowNode, { type: "join" }>["data"];
        })
      : null;

  const selectedDelayNode =
    selectedNode?.type === "delay"
      ? (selectedNode as FlowCanvasNode & {
          data: Extract<FlowNode, { type: "delay" }>["data"];
        })
      : null;

  const selectedAwaitEventNode =
    selectedNode?.type === "await_event"
      ? (selectedNode as FlowCanvasNode & {
          data: Extract<FlowNode, { type: "await_event" }>["data"];
        })
      : null;

  const selectedSetVariableNode =
    selectedNode?.type === "set_variable"
      ? (selectedNode as FlowCanvasNode & {
          data: Extract<FlowNode, { type: "set_variable" }>["data"];
        })
      : null;

  const selectedTransformNode =
    selectedNode?.type === "transform"
      ? (selectedNode as FlowCanvasNode & {
          data: Extract<FlowNode, { type: "transform" }>["data"];
        })
      : null;

  const selectedEndNode =
    selectedNode?.type === "end"
      ? (selectedNode as FlowCanvasNode & {
          data: Extract<FlowNode, { type: "end" }>["data"];
        })
      : null;

  return {
    selectedNode,
    selectedAgentDefinition,
    selectedStartNode,
    selectedStartConfig,
    scopedInstallationIds,
    effectiveInstallationId,
    selectedFlowInstallation,
    selectedAgentNode,
    selectedActionNode,
    selectedSlackTeamId,
    slackInstallations,
    slackConnectionsHref,
    selectedAgentHarness,
    apiKeysSettingsHref,
    selectedConditionNode,
    selectedParallelNode,
    selectedJoinNode,
    selectedDelayNode,
    selectedAwaitEventNode,
    selectedSetVariableNode,
    selectedTransformNode,
    selectedEndNode,
  };
}
