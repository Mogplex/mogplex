import { tool } from "ai";
import { z } from "zod";
import type { FlowGraph, FlowNode, FlowNodeType } from "@/lib/types";
import { CONDITION_HANDLE_IDS } from "@/lib/flows/graph";
import {
  setStartParams,
  setEndParams,
  addAgentNodeParams,
  addConditionNodeParams,
  addParallelNodeParams,
  addJoinNodeParams,
  addDelayNodeParams,
  addAwaitEventNodeParams,
  addSetVariableNodeParams,
  addTransformNodeParams,
} from "./assistant-tools-schemas";

export type ToolContext = {
  graph: FlowGraph;
  graphHydrated: boolean;
  allowedAgentIds: Set<string>;
  allowedModelIds: Set<string>;
  defaultModelId: string;
  mintId: (type: FlowNodeType) => string;
  autoPosition: () => { x: number; y: number };
  requireGraphHydrated: () => { error: string } | null;
  removeNodeByType: (type: "start" | "end") => void;
};

export function createSetStartTool(ctx: ToolContext) {
  return tool({
    description:
      "Replace or create the flow's single start node. Use exactly one of the supported trigger events.",
    inputSchema: setStartParams,
    execute: async ({
      label,
      event,
      isDefault,
      labelName,
      labelPrOnly,
      tagPattern,
      repos,
      authorFilter,
      scheduleCron,
      scheduleTimezone,
      slackTeamId,
      slackChannelId,
      position,
    }: z.infer<typeof setStartParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      ctx.removeNodeByType("start");
      const trimmedLabelName =
        event === "labeled" ? (labelName?.trim() ?? "") : "";
      const trimmedTagPattern =
        event === "tag_push" ? (tagPattern?.trim() ?? "") : "";
      const scopedRepos = Array.from(
        new Set((repos ?? []).map((repo) => repo.trim()).filter(Boolean))
      );
      const node: FlowNode = {
        id: "start",
        type: "start",
        position: position ?? { x: 80, y: 140 },
        data: {
          label,
          event,
          isDefault: isDefault ?? false,
          ...(trimmedLabelName ? { labelName: trimmedLabelName } : {}),
          ...(event === "labeled" && labelPrOnly === true
            ? { labelPrOnly: true }
            : {}),
          ...(trimmedTagPattern ? { tagPattern: trimmedTagPattern } : {}),
          ...(scopedRepos.length > 0 ||
          (event === "pr_opened" && authorFilter && authorFilter !== "any")
            ? {
                filter: {
                  scope: "all",
                  ...(scopedRepos.length > 0 ? { repos: scopedRepos } : {}),
                  ...(event === "pr_opened" &&
                  authorFilter &&
                  authorFilter !== "any"
                    ? { authorFilter }
                    : {}),
                },
              }
            : {}),
          ...(event === "schedule"
            ? {
                scheduleCron: scheduleCron?.trim() || "0 9 * * 1-5",
                scheduleTimezone: scheduleTimezone?.trim() || "UTC",
              }
            : {}),
          ...(event === "slack_mention" && slackTeamId?.trim()
            ? { slackTeamId: slackTeamId.trim() }
            : {}),
          ...(event === "slack_mention" && slackChannelId?.trim()
            ? { slackChannelId: slackChannelId.trim() }
            : {}),
        },
      };
      ctx.graph.nodes.push(node);
      return { id: node.id };
    },
  });
}

export function createSetEndTool(ctx: ToolContext) {
  return tool({
    description: "Replace or create the flow's single end node.",
    inputSchema: setEndParams,
    execute: async ({ label, position }: z.infer<typeof setEndParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      ctx.removeNodeByType("end");
      const node: FlowNode = {
        id: "end",
        type: "end",
        position: position ?? ctx.autoPosition(),
        data: { label },
      };
      ctx.graph.nodes.push(node);
      return { id: node.id };
    },
  });
}

export function createAddAgentNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add an agent node bound to one of the user's existing agents. agentId must come from the available agents list.",
    inputSchema: addAgentNodeParams,
    execute: async ({
      label,
      agentId,
      role,
      autofix,
      autoMerge,
      autoRevert,
      model,
      position,
    }: z.infer<typeof addAgentNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      if (!ctx.allowedAgentIds.has(agentId)) {
        return {
          error: `Unknown agentId "${agentId}". Choose one from the available agents list.`,
        };
      }
      const requestedModel = model?.trim();
      if (
        requestedModel &&
        ctx.allowedModelIds.size > 0 &&
        !ctx.allowedModelIds.has(requestedModel)
      ) {
        return {
          error: `Unknown model "${requestedModel}". Choose one of: ${[...ctx.allowedModelIds].join(", ")}.`,
        };
      }
      const id = ctx.mintId("agent");
      ctx.graph.nodes.push({
        id,
        type: "agent",
        position: position ?? ctx.autoPosition(),
        data: {
          label,
          agentId,
          harness: "mogplex",
          role,
          autofix,
          autoMerge,
          autoRevert,
          modelOverride: requestedModel || ctx.defaultModelId,
          maxStepsOverride: null,
          timeoutMsOverride: null,
          systemPromptOverride: null,
        },
      });
      return { id };
    },
  });
}

export function createAddConditionNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add an If branching node. Always connect both outgoing handles ('true' for the then branch and 'false' for the else branch) using the connect tool. Use the `rules` array for multi-rule logic, or pass field/operator/value for a single-rule branch.",
    inputSchema: addConditionNodeParams,
    execute: async ({
      label,
      field,
      operator,
      value,
      mode,
      rules,
      position,
    }: z.infer<typeof addConditionNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const resolvedRules =
        rules && rules.length > 0
          ? rules
          : field !== undefined || operator !== undefined || value !== undefined
            ? [
                {
                  field: field ?? "",
                  operator: operator ?? "equals",
                  value: value ?? "",
                },
              ]
            : [];
      if (resolvedRules.length === 0) {
        return {
          error:
            "addConditionNode requires either a non-empty `rules` array or the legacy field/operator/value triple.",
        };
      }
      const id = ctx.mintId("condition");
      ctx.graph.nodes.push({
        id,
        type: "condition",
        position: position ?? ctx.autoPosition(),
        data: {
          label,
          mode: mode ?? "all",
          rules: resolvedRules,
        },
      });
      return {
        id,
        handles: {
          then: CONDITION_HANDLE_IDS.true,
          else: CONDITION_HANDLE_IDS.false,
        },
      };
    },
  });
}

export function createAddParallelNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add a fan-out node. Needs exactly one incoming edge and at least two outgoing edges.",
    inputSchema: addParallelNodeParams,
    execute: async ({
      label,
      position,
    }: z.infer<typeof addParallelNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("parallel");
      ctx.graph.nodes.push({
        id,
        type: "parallel",
        position: position ?? ctx.autoPosition(),
        data: { label },
      });
      return { id };
    },
  });
}

export function createAddJoinNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add a fan-in node. Needs at least two incoming edges and exactly one outgoing edge. Choose a policy: wait_for_all (default), wait_for_any, or quorum (with required quorum count).",
    inputSchema: addJoinNodeParams,
    execute: async ({
      label,
      policy,
      quorum,
      position,
    }: z.infer<typeof addJoinNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("join");
      const resolvedPolicy = policy ?? "wait_for_all";
      ctx.graph.nodes.push({
        id,
        type: "join",
        position: position ?? ctx.autoPosition(),
        data: {
          label,
          policy: resolvedPolicy,
          quorum: resolvedPolicy === "quorum" ? (quorum ?? null) : null,
        },
      });
      return { id };
    },
  });
}

export function createAddDelayNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add a Wait (timed) node. Use this for fixed-time pauses; for waits that depend on a GitHub event, use addAwaitEventNode instead. Duration must be greater than zero.",
    inputSchema: addDelayNodeParams,
    execute: async ({
      label,
      duration,
      unit,
      position,
    }: z.infer<typeof addDelayNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("delay");
      ctx.graph.nodes.push({
        id,
        type: "delay",
        position: position ?? ctx.autoPosition(),
        data: { label, duration, unit },
      });
      return { id };
    },
  });
}

export function createAddAwaitEventNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add an Await event node that suspends the flow until a matching external event arrives. Supported kinds: github_label_added, github_comment_added, ci_workflow_completed, vercel_preview_ready, and manual_approval. Comment waits match the triggering issue or PR by default; CI and Vercel waits match the triggering commit by default. Optionally pass timeoutValue + timeoutUnit to fail the wait after a duration.",
    inputSchema: addAwaitEventNodeParams,
    execute: async ({
      label,
      kind,
      labelName,
      prOnly,
      bodyContains,
      authorLogin,
      matchTriggerIssue,
      workflowName,
      conclusion,
      environment,
      prompt,
      matchTriggerSha,
      timeoutValue,
      timeoutUnit,
      position,
    }: z.infer<typeof addAwaitEventNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("await_event");
      const timeout =
        typeof timeoutValue === "number" && timeoutValue > 0
          ? { value: timeoutValue, unit: timeoutUnit ?? "hours" }
          : null;
      const config =
        kind === "github_comment_added"
          ? {
              kind,
              bodyContains: bodyContains?.trim() ?? "",
              authorLogin: authorLogin?.trim().replace(/^@/, "") ?? "",
              prOnly: prOnly ?? true,
              matchTriggerIssue: matchTriggerIssue ?? true,
            }
          : kind === "ci_workflow_completed"
            ? {
                kind,
                workflowName: workflowName ?? "",
                conclusion: conclusion ?? "success",
                matchTriggerSha: matchTriggerSha ?? true,
              }
            : kind === "vercel_preview_ready"
              ? {
                  kind,
                  environment: environment ?? "Preview",
                  matchTriggerSha: matchTriggerSha ?? true,
                }
              : kind === "manual_approval"
                ? {
                    kind,
                    prompt: prompt ?? "",
                  }
                : {
                    kind: "github_label_added" as const,
                    labelName: labelName ?? "",
                    prOnly: prOnly ?? true,
                  };
      ctx.graph.nodes.push({
        id,
        type: "await_event",
        position: position ?? ctx.autoPosition(),
        data: {
          label,
          config,
          timeout,
        },
      });
      return { id };
    },
  });
}

export function createAddSetVariableNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add a Set variable node that writes deterministic values into per-run state. Each assignment has a `key` (read downstream as `state.<key>`) and a `template`. A whole-string `{{ path }}` template preserves the source type; mixed text interpolates as a string. Use this for branching on derived state without spending an agent call.",
    inputSchema: addSetVariableNodeParams,
    execute: async ({
      label,
      assignments,
      position,
    }: z.infer<typeof addSetVariableNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("set_variable");
      ctx.graph.nodes.push({
        id,
        type: "set_variable",
        position: position ?? ctx.autoPosition(),
        data: { label, assignments },
      });
      return { id };
    },
  });
}

export function createAddTransformNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add a deterministic Transform node that derives workflow state without an agent call. Supported operations: copy, string contains/split, array join/length/includes, changed-file glob matching, and boolean/number casts. Each result is written as state.<key> for downstream If nodes.",
    inputSchema: addTransformNodeParams,
    execute: async ({
      label,
      assignments,
      position,
    }: z.infer<typeof addTransformNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("transform");
      ctx.graph.nodes.push({
        id,
        type: "transform",
        position: position ?? ctx.autoPosition(),
        data: { label, assignments },
      });
      return { id };
    },
  });
}
