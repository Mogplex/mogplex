import { buildAppUrl } from "@/lib/app-url";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import { isUuid } from "@/lib/uuid";
import {
  SLACK_RUN_DETAILS_ACTION_ID,
  SLACK_VIEW_CHANGES_ACTION_ID,
} from "./command-actions";
import { runProgressTitle } from "./run-progress-presentation";
import { progressText } from "./run-progress-state";
import { readRunProgressSnapshot } from "./run-progress-store";

export const RUN_WORK_OBJECT_TYPE = "agent_run" as const;

const RUN_PATH = /^\/(?:[^/]+\/)?runs\/([^/]+)\/?$/;
const TERMINAL = new Set(["success", "failed", "cancelled"]);

/**
 * The run id in a link to a run page on this deployment (`/runs/<id>` or
 * `/<scope>/runs/<id>`), or null for any other link.
 */
export function parseRunLink(url: string, appOrigin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== appOrigin) return null;
  const runId = RUN_PATH.exec(parsed.pathname)?.[1];
  return runId && isUuid(runId) ? runId.toLowerCase() : null;
}

type TagColor = "red" | "yellow" | "green" | "gray" | "blue";

function runStatus(run: WorkObjectRun): { value: string; tag_color: TagColor } {
  switch (run.status) {
    case "pending":
      return { value: "Queued", tag_color: "gray" };
    case "streaming":
      return { value: "Running", tag_color: "blue" };
    case "awaiting_input":
      return {
        value:
          run.metadata.checkpoint_kind === "plan"
            ? "Plan ready for review"
            : "Waiting for you",
        tag_color: "yellow",
      };
    case "success":
      return { value: "Finished", tag_color: "green" };
    case "failed":
      return { value: "Failed", tag_color: "red" };
    default:
      return { value: "Cancelled", tag_color: "gray" };
  }
}

const HARNESS_LABELS: Record<string, string> = {
  mogplex: "Mogplex",
  codex: "Codex",
  "claude-code": "Claude Code",
};

const unixSeconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export type WorkObjectRun = Pick<
  ExternalAgentRunRow,
  | "id"
  | "status"
  | "prompt"
  | "harness"
  | "working_branch"
  | "metadata"
  | "created_at"
  | "updated_at"
> & { slack_progress?: unknown };

type WorkObjectField = {
  key: string;
  label: string;
  value: string;
  type: "string";
};
type WorkObjectAction = { text: string; action_id: string; value: string };

/** The task entity chat.unfurl and entity.presentDetails receive for a run. */
export type RunWorkObject = {
  app_unfurl_url?: string;
  url: string;
  external_ref: { id: string; type: typeof RUN_WORK_OBJECT_TYPE };
  entity_type: "slack#/entities/task";
  entity_payload: {
    attributes: {
      title: { text: string };
      display_id: string;
      display_type: string;
      product_name: string;
      metadata_last_modified: number;
    };
    fields: {
      status: { value: string; tag_color: TagColor };
      description?: { value: string };
      date_created: { value: number };
      date_updated: { value: number };
    };
    custom_fields: WorkObjectField[];
    display_order: string[];
    actions?: { primary_actions: WorkObjectAction[] };
  };
};

/**
 * A run as a Slack Work Object (task entity): title, status chip, the latest
 * progress summary, repository, branch and runner, with View changes and,
 * once the run ends, Details. Both buttons reuse the run card's handlers,
 * which apply their own access checks. Pass `appUnfurlUrl` for chat.unfurl;
 * leave it out for the flexpane.
 */
export function buildRunWorkObject(input: {
  run: WorkObjectRun;
  repoFullName?: string | null;
  appUnfurlUrl?: string;
}): RunWorkObject {
  const { run } = input;
  const summary = readRunProgressSnapshot(run.slack_progress)?.summary;
  const customFields = [
    ...(input.repoFullName
      ? [{ key: "repository", label: "Repository", value: input.repoFullName }]
      : []),
    {
      key: "branch",
      label: "Branch",
      value: progressText(run.working_branch, 200),
    },
    {
      key: "runner",
      label: "Runner",
      value: HARNESS_LABELS[run.harness] ?? run.harness,
    },
  ].map((field): WorkObjectField => ({ ...field, type: "string" }));
  const primaryActions: WorkObjectAction[] = [
    ...(run.status === "pending"
      ? []
      : [
          {
            text: TERMINAL.has(run.status) ? "View changes" : "Changes so far",
            action_id: SLACK_VIEW_CHANGES_ACTION_ID,
            value: run.id,
          },
        ]),
    ...(TERMINAL.has(run.status)
      ? [
          {
            text: "Details",
            action_id: SLACK_RUN_DETAILS_ACTION_ID,
            value: run.id,
          },
        ]
      : []),
  ];
  return {
    ...(input.appUnfurlUrl ? { app_unfurl_url: input.appUnfurlUrl } : {}),
    url: buildAppUrl(`/runs/${run.id}`).toString(),
    external_ref: { id: run.id, type: RUN_WORK_OBJECT_TYPE },
    entity_type: "slack#/entities/task",
    entity_payload: {
      attributes: {
        title: { text: runProgressTitle(run) },
        display_id: run.id.slice(0, 8),
        display_type: "Agent run",
        product_name: "Mogplex",
        metadata_last_modified: unixSeconds(run.updated_at),
      },
      fields: {
        status: runStatus(run),
        ...(summary ? { description: { value: summary } } : {}),
        date_created: { value: unixSeconds(run.created_at) },
        date_updated: { value: unixSeconds(run.updated_at) },
      },
      custom_fields: customFields,
      display_order: [
        "status",
        "description",
        ...customFields.map((field) => field.key),
        "date_updated",
      ],
      ...(primaryActions.length > 0
        ? { actions: { primary_actions: primaryActions } }
        : {}),
    },
  };
}
