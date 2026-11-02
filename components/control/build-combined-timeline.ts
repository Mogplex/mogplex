import { getToolOrDynamicToolName, isToolUIPart } from "ai";
import {
  diffFilesFromPatch,
  extractPatchFromValue,
} from "@/lib/control/diff-text";
import {
  resolveInfrastructureDiagnosticScope,
  sanitizeAgentUserFacingError,
  sanitizeAgentUserFacingText,
} from "@/lib/agents/user-facing-output";
import { redactSecretsInText } from "@/lib/ai-telemetry";
import type { TimelineEvent } from "@/lib/control/types";
import {
  toolActivityLabel,
  toolActivityDetail,
} from "@/lib/control/turn-progress";
import {
  controlToolOutcome,
  controlToolFailureDetail,
} from "@/lib/control/tool-outcome";
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

/**
 * Saves to the project's stored setup outlive the session, so the timeline
 * names what changed and says when a saved value was deleted or replaced.
 * Saved commands run on every later boot, so their text is shown too
 * (secrets redacted); variable values never are.
 */
const SETTING_NAMES: Partial<Record<string, string>> = {
  devCommand: "dev command",
  devPort: "dev port",
  installCommand: "install command",
  rootDirectory: "root directory",
  runtime: "runtime",
};

const SHOWN_SETTINGS = [
  "runtime",
  "rootDirectory",
  "installCommand",
  "devCommand",
  "devPort",
] as const;
const SHOWN_COMMAND_LENGTH = 180;
// What a null in each setting means on the next boot.
const NULL_SETTING: Record<(typeof SHOWN_SETTINGS)[number], string> = {
  runtime: "detected",
  rootDirectory: "repo root",
  installCommand: "detected",
  devCommand: "detected",
  devPort: "detected",
};

/** Redacted command text; a cut-off command ends with an ellipsis. */
function shownCommandText(command: string) {
  const text = redactSecretsInText(command);
  return text.length > SHOWN_COMMAND_LENGTH
    ? `${text.slice(0, SHOWN_COMMAND_LENGTH)}…`
    : text;
}

function settingsSaveBody(
  output: Record<string, unknown> | null,
  input: unknown
) {
  const replaced = Object.keys(asRecord(output?.replaced) ?? {}).map(
    (key) => SETTING_NAMES[key] ?? key
  );
  const heading =
    replaced.length > 0
      ? `Replaced saved project settings: ${replaced.join(", ")}`
      : "Project settings saved";
  return [heading, ...settingLines(input, output?.settings)].join(" · ");
}

/**
 * Each setting a save carries, with command text redacted. When the tool
 * returned the saved settings, show those: they are normalized the way the
 * next boot reads them.
 */
function settingLines(values: unknown, saved?: unknown) {
  const record = asRecord(values) ?? {};
  const stored = asRecord(saved);
  return SHOWN_SETTINGS.flatMap((key) => {
    if (record[key] === undefined) return [];
    const value = stored && key in stored ? stored[key] : record[key];
    const shown =
      value === null ? NULL_SETTING[key] : shownCommandText(String(value));
    return [`${SETTING_NAMES[key]}: ${shown}`];
  });
}

/** A refused settings save shows what it proposed and what is saved. */
function failureBody(
  toolName: string,
  output: Record<string, unknown> | null,
  input: unknown
) {
  const body = toolFailureBody(toolName, output);
  if (toolName !== "project_settings_update") return body;
  const proposed = settingLines(input);
  const saved = settingLines(output?.saved);
  return [
    body,
    ...(proposed.length > 0 ? [`proposed ${proposed.join(" · ")}`] : []),
    ...(saved.length > 0 ? [`saved ${saved.join(" · ")}`] : []),
  ].join(" · ");
}

function envSaveBody(output: Record<string, unknown> | null) {
  const name = typeof output?.name === "string" ? output.name : "variable";
  if (output?.deleted === true) return `Deleted saved variable ${name}`;
  if (output?.replaced === true) return `Replaced saved variable ${name}`;
  if (output?.unchanged === true) return `${name} was already unset`;
  return `Saved variable ${name}`;
}

const PROJECT_SAVE_BODIES: Partial<
  Record<
    string,
    (output: Record<string, unknown> | null, input: unknown) => string
  >
> = {
  project_env_set: envSaveBody,
  project_settings_update: settingsSaveBody,
};

function toolProgressBody(
  toolName: string,
  state: string,
  output: Record<string, unknown> | null,
  input?: unknown
) {
  const complete = state === "output-available";
  const projectSave = PROJECT_SAVE_BODIES[toolName];
  if (projectSave)
    return complete ? projectSave(output, input) : toolActivityLabel(toolName);
  if (toolName === "plan_mission")
    return complete ? "Plan saved" : "Saving plan";
  if (toolName === "sandbox_start") {
    if (!complete) return "Starting sandbox";
    // Defensive display for a future resolver that surfaces pending output.
    if (output?.status === "pending") return "Waiting for sandbox";
    if (output?.recoveredFromCleanup === true) {
      const waitMs =
        typeof output.cleanupWaitMs === "number" ? output.cleanupWaitMs : 0;
      return `Sandbox recovered and ready · cleanup ${Math.ceil(waitMs / 1000)}s`;
    }
    return "Sandbox ready";
  }
  if (toolName === "spawn_worktree") {
    return complete ? "Worktree created" : "Creating worktree";
  }
  if (toolName === "spawn_subagent") {
    return complete ? "Worker started" : "Starting worker";
  }
  return null;
}

const FAILURE_LABELS: Partial<Record<string, string>> = {
  spawn_worktree: "Worktree creation failed",
  spawn_subagent: "Worker start failed",
  plan_mission: "Plan could not be saved",
  project_env_set: "Variable save failed",
  project_settings_update: "Project settings save failed",
};

function toolFailureBody(
  toolName: string,
  output: Record<string, unknown> | null = null
) {
  if (toolName === "sandbox_start") {
    if (
      output?.reason === "multiple_sandboxes" ||
      output?.reason === "repo_mismatch"
    ) {
      return "Sandbox selection needed";
    }
    return "Sandbox startup failed.";
  }
  return FAILURE_LABELS[toolName] ?? `${toolName} failed`;
}

function toolDetails(toolName: string, input: unknown) {
  const argumentNames = Object.keys(asRecord(input) ?? {});
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
  let latestUserText = "";

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
      latestUserText = text;
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

    const userFacingOptions = {
      diagnosticScope: resolveInfrastructureDiagnosticScope(latestUserText),
      userRequestText: latestUserText,
    };

    let stepNumber = 0;
    for (const part of msg.parts) {
      if (typeof part !== "object" || part == null || !("type" in part)) {
        continue;
      }

      if (part.type === "step-start") {
        stepNumber += 1;
        continue;
      }

      if (isToolUIPart(part)) {
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
          const log =
            "errorText" in part ? String(part.errorText) : "unknown error";
          result.push({
            kind: "fail",
            label,
            time: "now",
            body: toolFailureBody(toolName),
            log: sanitizeAgentUserFacingError(log),
          });
        } else {
          const toolInput = "input" in part ? part.input : undefined;
          if (controlToolOutcome(state, output) === "failed") {
            result.push({
              kind: "fail",
              label,
              time: "now",
              body: failureBody(toolName, output, toolInput),
              log: sanitizeAgentUserFacingError(
                controlToolFailureDetail(output)
              ),
            });
            continue;
          }

          const progressBody = toolProgressBody(
            toolName,
            state,
            output,
            toolInput
          );
          result.push(
            progressBody
              ? {
                  kind: "progress",
                  label,
                  time: "now",
                  body: progressBody,
                  state: controlToolOutcome(state, output),
                }
              : {
                  kind: "tool",
                  label: "TOOL",
                  time: "now",
                  body: toolActivityLabel(toolName),
                  state: controlToolOutcome(state, output),
                  details:
                    toolActivityDetail(toolInput) ??
                    toolDetails(toolName, toolInput),
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
        const text = sanitizeAgentUserFacingText(
          String(part.text),
          userFacingOptions
        ).trim();
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
