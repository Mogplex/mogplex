import { getToolOrDynamicToolName, isToolOrDynamicToolUIPart } from "ai";
import {
  diffFilesFromPatch,
  extractPatchFromValue,
} from "@/lib/control/diff-text";
import type { TimelineEvent } from "@/lib/control/types";
import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from "ai";

/**
 * Check if a tool part is in an approval-requiring state (requested or responded).
 */
function isApprovalState(
  state: string
): state is "approval-requested" | "approval-responded" | "output-denied" {
  return (
    state === "approval-requested" ||
    state === "approval-responded" ||
    state === "output-denied"
  );
}

/**
 * Extract approval info from a tool part if present.
 */
function getApprovalInfo(part: UIMessagePart<UIDataTypes, UITools>): {
  id: string;
  approved?: boolean;
  reason?: string;
} | null {
  if (!("approval" in part) || !part.approval) return null;
  const approval = part.approval as {
    id: string;
    approved?: boolean;
    reason?: string;
  };
  return {
    id: approval.id,
    approved: approval.approved,
    reason: approval.reason,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toolProgressBody(
  toolName: string,
  state: string,
  output: Record<string, unknown> | null
) {
  const complete = state === "output-available";
  if (toolName === "plan_mission")
    return complete ? "Plan saved" : "Saving plan";
  if (toolName === "sandbox_start") {
    if (!complete) return "Starting sandbox";
    // Defensive display for a future resolver that surfaces pending output.
    return output?.status === "pending"
      ? "Waiting for sandbox"
      : "Sandbox ready";
  }
  if (toolName === "spawn_worktree") {
    return complete ? "Worktree created" : "Creating worktree";
  }
  if (toolName === "spawn_subagent") {
    return complete ? "Worker started" : "Starting worker";
  }
  return null;
}

function toolFailureBody(toolName: string) {
  if (toolName === "sandbox_start") {
    return "Sandbox startup failed.";
  }
  if (toolName === "spawn_worktree") return "Worktree creation failed";
  if (toolName === "spawn_subagent") return "Worker start failed";
  if (toolName === "plan_mission") return "Plan could not be saved";
  return `${toolName} failed`;
}

function toolDetails(toolName: string, input: unknown) {
  const argumentNames = Object.keys(asRecord(input) ?? {}).sort();
  return argumentNames.length > 0
    ? `${toolName}(${argumentNames.join(", ")})`
    : toolName;
}

/**
 * Builds a combined timeline by merging mission timeline events with chat
 * messages. User messages become YOU events; assistant text becomes MOGPLEX
 * events; tool invocations become TOOL events with argument names only (and
 * the error, when the call failed). Tool approvals become APPROVAL events.
 * Tool inputs or outputs carrying a unified patch become DIFF events so
 * changes render inline in the chat.
 */
export function buildCombinedTimeline(
  timeline: TimelineEvent[] | undefined,
  messages: UIMessage[]
): TimelineEvent[] {
  const result: TimelineEvent[] = [...(timeline || [])];

  // Append chat messages as timeline events
  for (const msg of messages) {
    if (!msg.parts || !Array.isArray(msg.parts)) continue;

    if (msg.role === "user") {
      const text = msg.parts
        .filter(
          (part): part is { type: "text"; text: string } =>
            part.type === "text" && "text" in part
        )
        .map((part) => part.text)
        .join("\n")
        .trim();
      const fileCount = msg.parts.filter((part) => part.type === "file").length;
      const body =
        text ||
        (fileCount > 0
          ? `${fileCount} attachment${fileCount === 1 ? "" : "s"} included.`
          : "");
      if (body) {
        result.push({ kind: "user", label: "YOU", time: "now", body });
      }
      continue;
    }

    if (msg.role !== "assistant") continue;

    let stepNumber = 0;
    for (const part of msg.parts) {
      if (typeof part !== "object" || part == null || !("type" in part)) {
        continue;
      }

      if (part.type === "step-start") {
        stepNumber += 1;
        continue;
      }

      if (isToolOrDynamicToolUIPart(part)) {
        const toolName = getToolOrDynamicToolName(part);
        const state = "state" in part ? String(part.state) : "";
        const output = asRecord("output" in part ? part.output : undefined);
        const label = stepNumber > 0 ? `STEP ${stepNumber}` : "PROGRESS";

        // Handle approval states
        if (isApprovalState(state)) {
          const approvalInfo = getApprovalInfo(part);
          const toolCallId =
            "toolCallId" in part ? String(part.toolCallId) : "";

          if (state === "approval-requested") {
            result.push({
              kind: "approval",
              label: "APPROVAL",
              time: "now",
              body: `${toolName} requires approval`,
              approvalText: `Approve ${toolName} to proceed?`,
              resolved: "",
              approvalId: approvalInfo?.id,
              toolCallId,
              toolName,
            });
          } else if (
            state === "approval-responded" ||
            state === "output-denied"
          ) {
            const isApproved = approvalInfo?.approved === true;
            result.push({
              kind: "approval",
              label: "APPROVAL",
              time: "now",
              body: `${toolName} ${isApproved ? "approved" : "denied"}`,
              approvalText: approvalInfo?.reason || "",
              resolved: isApproved ? "Approved by you" : "Denied by you",
              approvalId: approvalInfo?.id,
              toolCallId,
              toolName,
            });
          }
          continue;
        }

        // Handle other tool states
        if (state === "output-error") {
          result.push({
            kind: "fail",
            label,
            time: "now",
            body: toolFailureBody(toolName),
            log: "errorText" in part ? String(part.errorText) : "unknown error",
          });
        } else {
          const toolInput = "input" in part ? part.input : undefined;
          const structuredError =
            typeof output?.error === "string" ? output.error : null;
          if (output?.status === "error" || structuredError) {
            result.push({
              kind: "fail",
              label,
              time: "now",
              body: toolFailureBody(toolName),
              log: structuredError ?? "The tool returned an error.",
            });
            continue;
          }

          const progressBody = toolProgressBody(toolName, state, output);
          result.push(
            progressBody
              ? {
                  kind: "progress",
                  label,
                  time: "now",
                  body: progressBody,
                }
              : {
                  kind: "tool",
                  label: "TOOL",
                  time: "now",
                  body: `Using ${toolName}`,
                  details: toolDetails(toolName, toolInput),
                }
          );

          const patch =
            extractPatchFromValue("output" in part ? part.output : undefined) ??
            extractPatchFromValue(toolInput);
          if (patch) {
            result.push({
              kind: "diff",
              label: "DIFF",
              time: "now",
              body: `${toolName} changes`,
              patch,
              files: diffFilesFromPatch(patch),
            });
          }
        }
        continue;
      }

      // Text parts — skip empties: multi-step tool loops emit steps with no
      // text, and rendering them produces blank MOGPLEX bubbles.
      if (part.type === "text" && "text" in part) {
        const text = String(part.text).trim();
        if (!text) continue;
        result.push({
          kind: "assistant",
          label: "MOGPLEX",
          time: "now",
          body: text,
        });
      }
    }
  }

  return result;
}
