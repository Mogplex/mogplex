import { generateText, type ToolSet } from "ai";
import {
  loadToolApprovalSpentWaitMs,
  supabaseWaitStore,
  triggerWaitProvider,
} from "@/lib/flows/wait-service";
import {
  resolveToolApprovalContext,
  wrapToolsWithApprovalGate,
} from "@/lib/flows/tool-approval";
import type {
  FlowOperatorWaitProvider,
  FlowOperatorWaitStore,
} from "@/lib/flows/operators/types";
import {
  gatewayProviderOptions,
  withGatewaySystemCaching,
  type GatewayCallContext,
} from "@/lib/models/gateway-provider-routing";
import {
  AUTOMATION_GATEWAY_CACHING_ENV,
  type AutomationLanguageModel,
  type JobContext,
} from "@/lib/workflows/automation-job-types";
import { normalizeAutomationAssignmentType } from "@/lib/workflows/automation-job-utils";
import { getAutomationGenerateTimeoutMs } from "@/lib/workflows/automation-model-defaults";

export type AutomationAgentDeps = {
  generateText: typeof generateText;
  // Wait infrastructure for mid-run tool-call approval. The runner derives
  // the approval context from flow metadata, so only flow agent nodes with
  // requireApproval ever touch these.
  waitProvider: FlowOperatorWaitProvider;
  waitStore: FlowOperatorWaitStore;
  loadApprovalSpentWaitMs: typeof loadToolApprovalSpentWaitMs;
};

export const defaultAutomationAgentDeps: AutomationAgentDeps = {
  generateText,
  waitProvider: triggerWaitProvider,
  waitStore: supabaseWaitStore,
  loadApprovalSpentWaitMs: loadToolApprovalSpentWaitMs,
};

// Applies the tool-approval gate when the flow agent node opted in via
// requireApproval (stamped onto metadata by the agent-node executor). Runs
// without that flag pass tools through untouched.
export function applyToolApprovalGate(
  tools: ToolSet,
  context: JobContext,
  deps: AutomationAgentDeps
): ToolSet {
  const approvalContext = resolveToolApprovalContext(context);
  if (!approvalContext) return tools;
  return wrapToolsWithApprovalGate(tools, approvalContext, {
    waitProvider: deps.waitProvider,
    waitStore: deps.waitStore,
    loadSpentWaitMs: deps.loadApprovalSpentWaitMs,
    // Waits must never outlast this loop's own generation window — an
    // in-wait deadline abort would fail the run instead of denying the call.
    generationTimeoutMs: getAutomationGenerateTimeoutMs(
      context.agent.timeout_ms
    ),
  });
}

export function getAutomationGatewayCaching(): GatewayCallContext["caching"] {
  const value =
    process.env[AUTOMATION_GATEWAY_CACHING_ENV]?.trim().toLowerCase();
  if (value === "off" || value === "false" || value === "0") return "off";
  return "auto";
}

export function buildAutomationGatewayContext(
  context: JobContext,
  assignmentType = normalizeAutomationAssignmentType(context.assignmentType)
): GatewayCallContext {
  return {
    userId: context.repo.user_id,
    caching: getAutomationGatewayCaching(),
    tags: [
      "surface:automation",
      `type:${assignmentType}`,
      `repo:${context.repo.full_name}`,
      `flow:${typeof context.metadata.flow_id === "string" ? context.metadata.flow_id : "none"}`,
    ],
  };
}

export function buildAutomationSystem(
  system: string | undefined,
  gatewayContext: GatewayCallContext
): Parameters<typeof generateText>[0]["system"] {
  return system ? withGatewaySystemCaching(system, gatewayContext) : undefined;
}

export function fallbackAutomationModel(
  modelId: string,
  gatewayContext: GatewayCallContext
): AutomationLanguageModel {
  return {
    model: modelId,
    providerOptions: gatewayProviderOptions(modelId, gatewayContext),
    effectiveModelId: modelId,
  };
}
