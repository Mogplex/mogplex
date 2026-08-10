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

/**
 * Builds a combined timeline by merging mission timeline events with chat
 * messages. Assistant text becomes MOGPLEX events; tool invocations become
 * TOOL events with their input (and the error, when the call failed).
 * Tool approvals become APPROVAL events. Tool inputs or outputs carrying a
 * unified patch become DIFF events so changes render inline in the chat.
 */
export function buildCombinedTimeline(
  timeline: TimelineEvent[] | undefined,
  messages: UIMessage[]
): TimelineEvent[] {
  const result: TimelineEvent[] = [...(timeline || [])];

  // Append chat messages as timeline events
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    if (!msg.parts || !Array.isArray(msg.parts)) continue;

    for (const part of msg.parts) {
      if (typeof part !== "object" || part == null || !("type" in part)) {
        continue;
      }

      if (isToolOrDynamicToolUIPart(part)) {
        const toolName = getToolOrDynamicToolName(part);
        const state = "state" in part ? String(part.state) : "";

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
            label: "TOOL",
            time: "now",
            body: `${toolName} failed`,
            log: "errorText" in part ? String(part.errorText) : "unknown error",
          });
        } else {
          const toolInput = "input" in part ? part.input : undefined;
          const input =
            toolInput === undefined
              ? "…"
              : JSON.stringify(toolInput).slice(0, 100);
          result.push({
            kind: "tool",
            label: "TOOL",
            time: "now",
            body: `${toolName}(${input})`,
          });

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

      // Text parts
      if (part.type === "text" && "text" in part) {
        result.push({
          kind: "tool",
          label: "MOGPLEX",
          time: "now",
          body: String(part.text),
        });
      }
    }
  }

  return result;
}
