import type { ComponentType, SVGProps } from "react";
import type {
  FlowActionOperation,
  FlowAgentHarness,
  FlowAgentNodeRole,
  FlowConditionOperator,
  FlowNodeType,
  FlowStartAuthorFilter,
  TriggerEvent,
} from "@/lib/types";

export type Installation = {
  id: string;
  installation_id: number;
  account_login: string | null;
  account_type?: string | null;
  repositories: Array<{ id: string; full_name: string }>;
};

export type AutomationSandboxTestResult = {
  ok: boolean;
  error?: string;
  repo?: { id: string; full_name: string };
  env?: {
    configured: boolean;
    count: number;
    mode: string;
    source: string;
    warning: string | null;
  };
  sandbox?: {
    billingSource: string;
    credentialSource: string;
    projectId: string;
    teamId: string | null;
  };
};

export type AutomationHarnessAvailability = {
  available: boolean;
  billingSource: string | null;
  reason: string | null;
};

export type AutomationHarnessesResponse = {
  harnesses: Record<FlowAgentHarness, AutomationHarnessAvailability>;
};

export type SlackInstallation = {
  teamId: string;
  teamName: string | null;
};

export type SlackChannel = {
  id: string;
  name: string | null;
  isPrivate: boolean;
};

export type SlackChannelsPage = {
  channels: SlackChannel[];
  nextCursor: string | null;
};

export type FlowTab = "editor" | "runs";

export type FlowRenderableEdgeData = {
  label?: string | null;
  tone?:
    | "default"
    | "success"
    | "danger"
    | "condition"
    | "alternate"
    | "parallel"
    | "join";
  edgeId: string;
  onInsertMenu?: (edgeId: string, clientX: number, clientY: number) => void;
};

export type FlowNodeLibraryItem = {
  type: Exclude<FlowNodeType, "start" | "end">;
  operation?: FlowActionOperation;
  testId: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
};

export type FlowContextMenuState = {
  kind: "canvas" | "node" | "edge";
  x: number;
  y: number;
  flowPosition: { x: number; y: number } | null;
  nodeId: string | null;
  nodeType: string | null;
  edgeId: string | null;
};

export type WorkflowSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  active?: boolean;
};

export type InspectorCalloutVariant = "hint" | "warn" | "info";

export type PersistFlowOptions = {
  reason?: "manual" | "autosave" | "publish" | "template";
  silentSuccess?: boolean;
  snapshot?: import("@/lib/flows/editor").FlowDraftSnapshot;
};

export type TriggerPreset = {
  id: string;
  label: string;
  description: string;
  event: TriggerEvent;
  icon: ComponentType<{ className?: string }>;
  authorFilter?: FlowStartAuthorFilter;
  canvasLabel?: string;
};

export type FlowAgentRoleOption = {
  value: FlowAgentNodeRole;
  label: string;
  description: string;
};

export type FlowAgentHarnessOption = {
  value: FlowAgentHarness;
  label: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export type FlowActionOption = {
  value: FlowActionOperation;
  label: string;
  description: string;
  testId: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
  provider: "Sandbox" | "Slack" | "GitHub";
};

export type ConditionOperatorOption = FlowConditionOperator;
