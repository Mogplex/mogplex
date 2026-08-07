import { FlowServiceError } from "@/lib/flows/errors";
import { createFlowAssistantTools } from "@/lib/flows/assistant-tools";
import { coerceGraph, validateFlowGraph } from "@/lib/flows/graph";
import type { FlowAssistantResultData } from "@/lib/flows/assistant-chat-payload";
import {
  captureUsage,
  EMPTY_CAPTURED_USAGE,
  fillUsageGaps,
  mergeUsage,
  type CapturedUsage,
} from "@/lib/observability/usage";
import type { LanguageModelUsage, ProviderMetadata } from "ai";

// AI Gateway / ai_models catalog id — resolves to Anthropic Claude Sonnet 4.6
// via resolveUserLanguageModel. Not the direct Anthropic API model slug.
// See scripts/016_seed_ai_models.sql for the mapping.
export const FLOW_ASSISTANT_MODEL_ID = "anthropic/claude-sonnet-4.6";

// A complex flow with 10+ nodes, conditions, and parallel branches typically
// takes ~15-25 tool calls. 40 leaves headroom for finalize re-runs when the
// first validation pass flags errors the model needs to fix.
export const FLOW_ASSISTANT_MAX_STEPS = 40;

export const FLOW_ASSISTANT_SYSTEM_PROMPT = [
  "You help users design deterministic repo automation workflows on a node canvas.",
  "Build the flow by calling tools that mutate a working graph. Do not emit prose — call tools only.",
  "Always ensure exactly one start node and exactly one end node exist. Use setStart and setEnd for those.",
  "Supported node types: start, agent, action, condition (presented as 'If'), parallel, join, delay (presented as 'Wait'), await_event (presented as 'Await event'), set_variable (presented as 'Set variable'), transform (presented as 'Transform'), end.",
  "Start events include GitHub events plus schedule, signed webhook, and Slack mention. schedule, webhook, and slack_mention must scope exactly one owner/repo. Dependabot automation is pr_opened with authorFilter=dependabot_only.",
  "Agent nodes must use an agentId from the available agents list. Roles: review (analysis), edit (apply changes after review), triage (classification/response).",
  "Use If (condition) nodes for then/else branching: connect the 'true' handle to the then branch and the 'false' handle to the else branch. Pass `rules` (with optional `mode: \"all\" | \"any\"`) for multi-rule logic; the legacy field/operator/value triple still works for one-rule branches. Use parallel for fan-out, join for fan-in, delay (Wait) for fixed-time pauses, and await_event for GitHub labels or comments, CI completion, Vercel preview readiness, or a manual approval.",
  "Join policies: wait_for_all (default) merges once every branch reports; wait_for_any emits as soon as the first active branch arrives and ignores later branches; quorum emits once `quorum` active branches have reported, and skips downstream when that becomes impossible. Quorum must be at least 2 and at most the number of incoming edges.",
  "Set variable nodes write deterministic values into per-run state. Each assignment has a key and a template; a whole-string `{{ path }}` template preserves the source type while mixed text interpolates as a string. Templates resolve against metadata, repo, outputs, outputs_by_label, previous_outputs, and the current state. Downstream If nodes read these as `state.<key>`. Prefer set_variable + If over a triage agent when the decision is purely metadata-driven.",
  "Transform nodes derive typed state without an agent call. Use copy, string_contains, string_split, array_join, array_length, array_includes, files_match_glob, cast_boolean, or cast_number against a source path, then read the result as `state.<key>`. Use separate Transform nodes when one derived value must feed another.",
  "Action nodes perform deterministic side effects. Available actions run a static sandbox command, send a templated Slack message to a selected channel or the triggering thread, post a GitHub issue/PR comment, create a GitHub issue, add/remove GitHub labels, set a commit status, submit a PR review, or request a safe squash merge after the workflow completes. GitHub actions are always restricted to the workflow repository. Leave their target number or commit SHA unset to use the triggering entity.",
  "Keep labels concise and preserve the user's intent. Do not invent trigger events.",
  "When you are finished and the graph is complete and connected from start to end, call finalize with a short summary.",
].join("\n");

// Conversational variant of the flow-assistant prompt used by the in-canvas
// chat panel (`/api/flows/[id]/chat`). Unlike `FLOW_ASSISTANT_SYSTEM_PROMPT`
// this allows prose replies (questions, explanations, confirmations) alongside
// tool calls, and does not force a `finalize` call.
export const FLOW_ASSISTANT_CHAT_SYSTEM_PROMPT = [
  "You are the Flow assistant for a node-based repo automation canvas. You help the user design and edit a deterministic flow by both talking to them and calling tools that mutate a working graph.",
  "You may reply in prose: ask clarifying questions, explain trade-offs, and confirm before making large or destructive changes (e.g. removing several nodes or rewiring the whole flow). For small, clearly-requested edits, just make them.",
  "Build and edit the flow by calling the provided tools. After you change the graph, briefly tell the user in prose what you changed.",
  "Always keep exactly one start node and exactly one end node. Use setStart and setEnd for those.",
  "Supported node types: start, agent, action, condition (presented as 'If'), parallel, join, delay (presented as 'Wait'), await_event (presented as 'Await event'), set_variable (presented as 'Set variable'), transform (presented as 'Transform'), end.",
  "Start events include GitHub events plus schedule, signed webhook, and Slack mention. schedule, webhook, and slack_mention must scope exactly one owner/repo. Dependabot automation is pr_opened with authorFilter=dependabot_only.",
  "Agent nodes must use an agentId from the available agents list. Roles: review (analysis), edit (apply changes after review), triage (classification/response).",
  "Use If (condition) nodes for then/else branching: connect the 'true' handle to the then branch and the 'false' handle to the else branch. Pass `rules` (with optional `mode: \"all\" | \"any\"`) for multi-rule logic; the legacy field/operator/value triple still works for one-rule branches. Use parallel for fan-out, join for fan-in, delay (Wait) for fixed-time pauses, and await_event for GitHub labels or comments, CI completion, Vercel preview readiness, or a manual approval.",
  "Join policies: wait_for_all (default) merges once every branch reports; wait_for_any emits as soon as the first active branch arrives; quorum emits once `quorum` active branches have reported. Quorum must be at least 2 and at most the number of incoming edges.",
  "Set variable nodes write deterministic values into per-run state; downstream If nodes read them as `state.<key>`. Prefer set_variable + If over a triage agent when the decision is purely metadata-driven.",
  "Transform nodes derive typed state without an agent call using copy, string/array helpers, changed-file glob matching, and boolean/number casts. Results are available downstream as `state.<key>`.",
  "Action nodes perform deterministic side effects in the workflow repository: static sandbox commands, Slack channel/thread messages, GitHub comments, issues, labels, commit statuses, and PR reviews. Prefer these over an agent when the exact side effect is already known.",
  "Keep labels concise and preserve the user's intent. Do not invent trigger events. Call getGraphState before inspecting or editing the live canvas graph. After getGraphState returns, use getGraph whenever you need to inspect the working graph again.",
  "When the graph is complete and connected from start to end, you may call finalize with a short summary, but it is not required for the user to apply your changes.",
].join("\n");

export function buildFlowAssistantResultData(
  working: ReturnType<ReturnType<typeof createFlowAssistantTools>["getResult"]>
): FlowAssistantResultData {
  if (!working.hydrated) {
    return {
      graph: null,
      summary: working.summary,
      finalized: working.done,
      valid: false,
      errors: ["The live canvas graph was not loaded."],
    };
  }

  try {
    const graph = coerceGraph(working.graph);
    const validation = validateFlowGraph(graph, {
      requireRunnableConfig: true,
    });
    return {
      graph,
      summary: working.summary,
      finalized: working.done,
      valid: validation.valid,
      errors: validation.valid ? null : validation.errors,
    };
  } catch (error) {
    return {
      graph: null,
      summary: working.summary,
      finalized: working.done,
      valid: false,
      errors: [
        error instanceof Error
          ? error.message
          : "Assistant produced an unreadable graph.",
      ],
    };
  }
}

/**
 * Merge per-step usage with the final aggregate. Generation IDs are unioned
 * from both sources because the SDK surfaces some only on the aggregate.
 */
export function mergeFlowAssistantUsage(
  observedStepUsages: readonly CapturedUsage[],
  generation: { totalUsage?: unknown; providerMetadata?: unknown }
) {
  const observedUsage = observedStepUsages.reduce(
    (usage, stepUsage) => mergeUsage(usage, stepUsage),
    EMPTY_CAPTURED_USAGE
  );
  const totalCapturedUsage = captureUsage(
    generation.totalUsage as LanguageModelUsage | undefined,
    generation.providerMetadata as ProviderMetadata | undefined
  );

  return fillUsageGaps(
    {
      ...totalCapturedUsage,
      generationId:
        observedUsage.generationId ?? totalCapturedUsage.generationId,
      generationIds: [
        ...new Set([
          ...observedUsage.generationIds,
          ...totalCapturedUsage.generationIds,
        ]),
      ],
    },
    observedUsage
  );
}

/** The tool loop must reach `finalize`; anything else is a failed suggestion. */
export function flowAssistantIncompleteError(
  stepsTaken: number
): FlowServiceError {
  return new FlowServiceError(
    "FLOW_ASSISTANT_INVALID_GRAPH",
    stepsTaken >= FLOW_ASSISTANT_MAX_STEPS
      ? `Assistant ran out of steps (${stepsTaken}/${FLOW_ASSISTANT_MAX_STEPS}) before completing the flow. Try a simpler request or break it into smaller changes.`
      : "Assistant stopped before finalizing a flow graph. Try rephrasing your request."
  );
}
