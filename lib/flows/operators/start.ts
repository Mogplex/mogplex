import type {
  FlowNode,
  FlowStartAuthorFilter,
  FlowStartFilter,
  FlowStartFilterScope,
  TriggerEvent,
} from "@/lib/types";
import { eventLabel } from "@/lib/flows/graph-helpers";
import type { FlowOperatorDefinition } from "./types";

type StartNode = Extract<FlowNode, { type: "start" }>;

const VALID_SCOPES: ReadonlySet<FlowStartFilterScope> = new Set([
  "all",
  "org",
  "personal",
]);

const VALID_AUTHOR_FILTERS: ReadonlySet<FlowStartAuthorFilter> = new Set([
  "any",
  "humans_only",
  "exclude_dependabot",
  "dependabot_only",
]);

const VALID_TRIGGER_EVENTS: ReadonlySet<TriggerEvent> = new Set([
  "mention",
  "pr_opened",
  "issue_opened",
  "pr_comment",
  "issue_comment",
  "push",
  "ci_failure",
  "labeled",
  "tag_push",
  "schedule",
  "webhook",
  "slack_mention",
]);

const REPO_BOUND_EXTERNAL_EVENTS: ReadonlySet<TriggerEvent> = new Set([
  "schedule",
  "webhook",
  "slack_mention",
]);

export function isValidFlowCron(value: string) {
  const fields = value.trim().split(/\s+/);
  return (
    fields.length === 5 &&
    fields.every(
      (field) => field.length > 0 && /^[0-9A-Za-z*,/?#-]+$/.test(field)
    )
  );
}

export function isValidFlowTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function coerceStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const cleaned = raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

function coerceNumberArray(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const cleaned = raw.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value)
  );
  return cleaned.length > 0 ? cleaned : undefined;
}

function coerceStartFilter(
  raw: unknown,
  event: TriggerEvent
): FlowStartFilter | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const explicitScope =
    typeof record.scope === "string" &&
    VALID_SCOPES.has(record.scope as FlowStartFilterScope)
      ? (record.scope as FlowStartFilterScope)
      : undefined;
  const installationIds = coerceNumberArray(record.installationIds);
  const repos = coerceStringArray(record.repos);
  // Author filters only make sense for pr_opened (the only event that routes
  // with PR-author context). Drop them for other events: a stale
  // dependabot_only left behind by an event switch would otherwise fail
  // closed on every delivery and silently stop the flow from routing.
  const authorFilter =
    event === "pr_opened" &&
    typeof record.authorFilter === "string" &&
    record.authorFilter !== "any" &&
    VALID_AUTHOR_FILTERS.has(record.authorFilter as FlowStartAuthorFilter)
      ? (record.authorFilter as FlowStartAuthorFilter)
      : undefined;

  // Treat objects with no recognized fields ({}, { scope: "garbage" }, etc.)
  // as "no filter" so the dual-read parity log accurately surfaces them under
  // flows_no_filter rather than silently counting them as a populated filter.
  if (!explicitScope && !installationIds && !repos && !authorFilter)
    return undefined;

  const filter: FlowStartFilter = { scope: explicitScope ?? "all" };
  if (installationIds) filter.installationIds = installationIds;
  if (repos) filter.repos = repos;
  if (authorFilter) filter.authorFilter = authorFilter;
  return filter;
}

export const startOperator: FlowOperatorDefinition<StartNode> = {
  type: "start",
  // Structural rules for the start node (single, no incoming, exactly one
  // outgoing) live in validateFlowGraph itself because they require the global
  // graph view, not just this node's edges.
  validate: ({ node }) => {
    const errors: string[] = [];
    const repoCount = node.data.filter?.repos?.length ?? 0;
    if (REPO_BOUND_EXTERNAL_EVENTS.has(node.data.event) && repoCount !== 1) {
      errors.push(
        `${eventLabel(node.data.event)} triggers must select exactly one repository.`
      );
    }
    if (node.data.event === "schedule") {
      if (!isValidFlowCron(node.data.scheduleCron ?? "")) {
        errors.push("Schedule triggers must define a valid five-field cron.");
      }
      if (!isValidFlowTimezone(node.data.scheduleTimezone ?? "")) {
        errors.push("Schedule triggers must define a valid IANA timezone.");
      }
    }
    if (node.data.event === "slack_mention") {
      if (!node.data.slackTeamId?.trim()) {
        errors.push("Slack mention triggers must select a workspace.");
      }
      if (!node.data.slackChannelId?.trim()) {
        errors.push("Slack mention triggers must select a channel.");
      }
    }
    return errors;
  },
  coerceData: (raw) => {
    const event =
      typeof raw.event === "string" &&
      VALID_TRIGGER_EVENTS.has(raw.event as TriggerEvent)
        ? (raw.event as TriggerEvent)
        : "mention";
    const filter = coerceStartFilter(raw.filter, event);
    // Label fields only make sense for the `labeled` event. Drop them for
    // other events (same rationale as the authorFilter drop above): a stale
    // labelName left behind by an event switch would silently narrow routing.
    const labelName =
      event === "labeled" && typeof raw.labelName === "string"
        ? raw.labelName.trim()
        : "";
    const labelPrOnly = event === "labeled" && raw.labelPrOnly === true;
    const tagPattern =
      event === "tag_push" && typeof raw.tagPattern === "string"
        ? raw.tagPattern.trim()
        : "";
    const scheduleCron =
      event === "schedule" && typeof raw.scheduleCron === "string"
        ? raw.scheduleCron.trim()
        : "";
    const scheduleTimezone =
      event === "schedule" && typeof raw.scheduleTimezone === "string"
        ? raw.scheduleTimezone.trim()
        : "";
    const slackTeamId =
      event === "slack_mention" && typeof raw.slackTeamId === "string"
        ? raw.slackTeamId.trim()
        : "";
    const slackChannelId =
      event === "slack_mention" && typeof raw.slackChannelId === "string"
        ? raw.slackChannelId.trim()
        : "";
    const slackChannelName =
      event === "slack_mention" && typeof raw.slackChannelName === "string"
        ? raw.slackChannelName.trim()
        : "";
    return {
      label: String(raw.label ?? "Start"),
      event,
      isDefault: raw.isDefault === true,
      ...(filter ? { filter } : {}),
      ...(labelName ? { labelName } : {}),
      ...(labelPrOnly ? { labelPrOnly: true } : {}),
      ...(tagPattern ? { tagPattern } : {}),
      ...(scheduleCron ? { scheduleCron } : {}),
      ...(scheduleTimezone ? { scheduleTimezone } : {}),
      ...(slackTeamId ? { slackTeamId } : {}),
      ...(slackChannelId ? { slackChannelId } : {}),
      ...(slackChannelName ? { slackChannelName } : {}),
    };
  },
  defaultData: (input) => {
    const event = input.event ?? "mention";
    return {
      label: input.label?.trim() || eventLabel(event),
      event,
      isDefault: input.isDefault ?? event === "mention",
      ...(event === "schedule"
        ? { scheduleCron: "0 9 * * 1-5", scheduleTimezone: "UTC" }
        : {}),
    };
  },
  execute: async ({ node, label, completeNodeRun, emit }) => {
    const summary = `Started from ${node.data.event}`;
    await completeNodeRun({
      status: "success",
      output: {
        event: node.data.event,
        default: node.data.isDefault === true,
      },
    });
    return { ok: true, emitted: emit(label, summary) };
  },
};
