import { FAILURE_HANDLE_ID } from "@/lib/flows/graph-helpers";
import type {
  FlowActionNodeData,
  FlowActionOperation,
  FlowNode,
} from "@/lib/types";
import { resolveTemplate } from "./state";
import type { FlowOperatorDefinition } from "./types";

type ActionNode = Extract<FlowNode, { type: "action" }>;

const ACTION_OPERATIONS: ReadonlySet<FlowActionOperation> = new Set([
  "sandbox.run_command",
  "slack.send_message",
  "github.post_comment",
  "github.create_issue",
  "github.update_labels",
  "github.set_status",
  "github.submit_review",
  "github.merge_pull_request",
]);

function isActionOperation(value: unknown): value is FlowActionOperation {
  return ACTION_OPERATIONS.has(value as FlowActionOperation);
}

function containsTemplateSyntax(value: string) {
  return value.includes("{{");
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        )
      )
    : [];
}

function defaultActionLabel(operation: FlowActionOperation) {
  switch (operation) {
    case "slack.send_message":
      return "Send Slack message";
    case "github.post_comment":
      return "Post GitHub comment";
    case "github.create_issue":
      return "Create GitHub issue";
    case "github.update_labels":
      return "Update GitHub labels";
    case "github.set_status":
      return "Set commit status";
    case "github.submit_review":
      return "Submit PR review";
    case "github.merge_pull_request":
      return "Request safe merge";
    default:
      return "Run command";
  }
}

export function createDefaultFlowActionData(
  operation: FlowActionOperation,
  nextIndex: number,
  requestedLabel?: string | null
): FlowActionNodeData {
  const label =
    requestedLabel?.trim() || `${defaultActionLabel(operation)} ${nextIndex}`;
  switch (operation) {
    case "slack.send_message":
      return {
        label,
        operation,
        destination: "channel",
        teamId: "",
        channelId: "",
        channelName: null,
        message: "",
        unfurlLinks: false,
      };
    case "github.post_comment":
      return {
        label,
        operation,
        targetNumber: null,
        body: "",
      };
    case "github.create_issue":
      return {
        label,
        operation,
        title: "",
        body: "",
        labels: [],
      };
    case "github.update_labels":
      return {
        label,
        operation,
        targetNumber: null,
        addLabels: [],
        removeLabels: [],
      };
    case "github.set_status":
      return {
        label,
        operation,
        commitSha: null,
        state: "success",
        context: "mogplex/workflow",
        description: null,
        targetUrl: null,
      };
    case "github.submit_review":
      return {
        label,
        operation,
        pullRequestNumber: null,
        event: "COMMENT",
        body: "",
      };
    case "github.merge_pull_request":
      return {
        label,
        operation,
        pullRequestNumber: null,
        commitTitle: null,
      };
    default:
      return {
        label,
        operation,
        command: "pnpm test",
        workingDirectory: null,
      };
  }
}

function coerceActionData(raw: Record<string, unknown>): FlowActionNodeData {
  const operation = isActionOperation(raw.operation)
    ? raw.operation
    : "sandbox.run_command";
  const label =
    typeof raw.label === "string" ? raw.label : defaultActionLabel(operation);

  if (operation === "slack.send_message") {
    return {
      label,
      operation,
      destination:
        raw.destination === "trigger_thread" ? "trigger_thread" : "channel",
      teamId: typeof raw.teamId === "string" ? raw.teamId : "",
      channelId: typeof raw.channelId === "string" ? raw.channelId : "",
      channelName: typeof raw.channelName === "string" ? raw.channelName : null,
      message: typeof raw.message === "string" ? raw.message : "",
      unfurlLinks: raw.unfurlLinks === true,
    };
  }

  if (operation === "github.post_comment") {
    return {
      label,
      operation,
      targetNumber: optionalString(raw.targetNumber),
      body: typeof raw.body === "string" ? raw.body : "",
    };
  }

  if (operation === "github.create_issue") {
    return {
      label,
      operation,
      title: typeof raw.title === "string" ? raw.title : "",
      body: typeof raw.body === "string" ? raw.body : "",
      labels: stringArray(raw.labels),
    };
  }

  if (operation === "github.update_labels") {
    return {
      label,
      operation,
      targetNumber: optionalString(raw.targetNumber),
      addLabels: stringArray(raw.addLabels),
      removeLabels: stringArray(raw.removeLabels),
    };
  }

  if (operation === "github.set_status") {
    return {
      label,
      operation,
      commitSha: optionalString(raw.commitSha),
      state: ["pending", "success", "failure", "error"].includes(
        String(raw.state)
      )
        ? (raw.state as "pending" | "success" | "failure" | "error")
        : "success",
      context:
        typeof raw.context === "string" ? raw.context : "mogplex/workflow",
      description: optionalString(raw.description),
      targetUrl: optionalString(raw.targetUrl),
    };
  }

  if (operation === "github.submit_review") {
    return {
      label,
      operation,
      pullRequestNumber: optionalString(raw.pullRequestNumber),
      event: ["COMMENT", "APPROVE", "REQUEST_CHANGES"].includes(
        String(raw.event)
      )
        ? (raw.event as "COMMENT" | "APPROVE" | "REQUEST_CHANGES")
        : "COMMENT",
      body: typeof raw.body === "string" ? raw.body : "",
    };
  }

  if (operation === "github.merge_pull_request") {
    return {
      label,
      operation,
      pullRequestNumber: optionalString(raw.pullRequestNumber),
      commitTitle: optionalString(raw.commitTitle),
    };
  }

  return {
    label,
    operation,
    command: typeof raw.command === "string" ? raw.command : "",
    workingDirectory:
      typeof raw.workingDirectory === "string" && raw.workingDirectory.trim()
        ? raw.workingDirectory
        : null,
  };
}

export const actionOperator: FlowOperatorDefinition<ActionNode> = {
  type: "action",
  canFail: true,
  validate: ({ node, inbound, outbound, startNode }) => {
    const errors: string[] = [];
    if (inbound.length !== 1) {
      errors.push(
        `Action "${node.data.label}" must have exactly one incoming edge.`
      );
    }
    const successEdges = outbound.filter(
      (edge) => edge.sourceHandle !== FAILURE_HANDLE_ID
    );
    if (successEdges.length !== 1) {
      errors.push(
        `Action "${node.data.label}" must have exactly one outgoing edge.`
      );
    }
    if (
      node.data.operation === "sandbox.run_command" &&
      !node.data.command.trim()
    ) {
      errors.push(`Action "${node.data.label}" must define a command.`);
    }
    if (
      node.data.operation === "sandbox.run_command" &&
      containsTemplateSyntax(node.data.command)
    ) {
      errors.push(
        `Action "${node.data.label}" cannot use templates in shell commands.`
      );
    }
    if (node.data.operation === "slack.send_message") {
      if (
        node.data.destination === "trigger_thread" &&
        startNode.data.event !== "slack_mention"
      ) {
        errors.push(
          `Action "${node.data.label}" can only reply to the triggering thread from a Slack mention trigger.`
        );
      }
      if (
        node.data.destination !== "trigger_thread" &&
        !node.data.teamId.trim()
      ) {
        errors.push(
          `Action "${node.data.label}" must select a Slack workspace.`
        );
      }
      if (
        node.data.destination !== "trigger_thread" &&
        !node.data.channelId.trim()
      ) {
        errors.push(`Action "${node.data.label}" must select a Slack channel.`);
      }
      if (!node.data.message.trim()) {
        errors.push(`Action "${node.data.label}" must define a message.`);
      }
    }
    if (
      node.data.operation === "github.post_comment" &&
      !node.data.body.trim()
    ) {
      errors.push(`Action "${node.data.label}" must define a comment body.`);
    }
    if (
      node.data.operation === "github.create_issue" &&
      !node.data.title.trim()
    ) {
      errors.push(`Action "${node.data.label}" must define an issue title.`);
    }
    if (
      node.data.operation === "github.update_labels" &&
      node.data.addLabels.length === 0 &&
      node.data.removeLabels.length === 0
    ) {
      errors.push(
        `Action "${node.data.label}" must add or remove at least one label.`
      );
    }
    if (node.data.operation === "github.set_status") {
      if (!node.data.context.trim()) {
        errors.push(
          `Action "${node.data.label}" must define a status context.`
        );
      }
      if (node.data.targetUrl && !containsTemplateSyntax(node.data.targetUrl)) {
        try {
          const url = new URL(node.data.targetUrl);
          if (!["http:", "https:"].includes(url.protocol)) {
            throw new Error("Unsupported status URL protocol");
          }
        } catch {
          errors.push(
            `Action "${node.data.label}" must use an http(s) status URL.`
          );
        }
      }
    }
    if (
      node.data.operation === "github.submit_review" &&
      !node.data.body.trim()
    ) {
      errors.push(`Action "${node.data.label}" must define a review body.`);
    }
    return errors;
  },
  coerceData: coerceActionData,
  defaultData: (input) =>
    createDefaultFlowActionData(
      input.operation ?? "sandbox.run_command",
      input.nextIndex,
      input.label
    ),
  execute: async ({
    node,
    label,
    shouldSkip,
    outputs,
    resolutionState,
    completeNodeRun,
    completeSkipped,
    emit,
    actionRunner,
    jobRunId,
  }) => {
    if (shouldSkip) {
      return completeSkipped(
        "Action skipped because every incoming branch was skipped"
      );
    }

    const resolveText = (value: string) =>
      stringValue(resolveTemplate(value, resolutionState));
    const resolveOptionalText = (value: string | null) =>
      value ? resolveText(value).trim() || null : null;
    const resolveLabels = (values: string[]) =>
      Array.from(
        new Set(values.map(resolveText).map((value) => value.trim()))
      ).filter(Boolean);

    let action: FlowActionNodeData;
    switch (node.data.operation) {
      case "slack.send_message":
        action = { ...node.data, message: resolveText(node.data.message) };
        break;
      case "github.post_comment":
        action = {
          ...node.data,
          targetNumber: resolveOptionalText(node.data.targetNumber),
          body: resolveText(node.data.body),
        };
        break;
      case "github.create_issue":
        action = {
          ...node.data,
          title: resolveText(node.data.title),
          body: resolveText(node.data.body),
          labels: resolveLabels(node.data.labels),
        };
        break;
      case "github.update_labels":
        action = {
          ...node.data,
          targetNumber: resolveOptionalText(node.data.targetNumber),
          addLabels: resolveLabels(node.data.addLabels),
          removeLabels: resolveLabels(node.data.removeLabels),
        };
        break;
      case "github.set_status":
        action = {
          ...node.data,
          commitSha: resolveOptionalText(node.data.commitSha),
          description: resolveOptionalText(node.data.description),
          targetUrl: resolveOptionalText(node.data.targetUrl),
        };
        break;
      case "github.submit_review":
        action = {
          ...node.data,
          pullRequestNumber: resolveOptionalText(node.data.pullRequestNumber),
          body: resolveText(node.data.body),
        };
        break;
      case "github.merge_pull_request":
        action = {
          ...node.data,
          pullRequestNumber: resolveOptionalText(node.data.pullRequestNumber),
          commitTitle: resolveOptionalText(node.data.commitTitle),
        };
        break;
      default:
        action = {
          ...node.data,
          workingDirectory: node.data.workingDirectory
            ? resolveText(node.data.workingDirectory)
            : null,
        };
    }

    const result = await actionRunner({
      jobRunId,
      nodeId: node.id,
      action,
    });
    outputs.set(node.id, { label, text: result.summary });
    await completeNodeRun({
      status: "success",
      output: {
        operation: action.operation,
        ...result.output,
      },
    });
    return {
      ok: true,
      emitted: emit(label, result.summary, { payload: result.output }),
    };
  },
};
