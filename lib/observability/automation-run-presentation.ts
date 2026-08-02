import { isRecord } from "@/lib/utils/type-guards";

type AutomationMetadata = Record<string, unknown> | null | undefined;

export type AutomationCostSource = "trigger" | "gateway" | "manual" | null;

export type AutomationCostState =
  | "known"
  | "reconciled"
  | "partial"
  | "missing"
  | "unknown";

export type AutomationStatusPresentation = {
  label: string;
  isTimedOut: boolean;
  failureClass: string | null;
  timeoutBudgetMs: number | null;
};

function readOptionalString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readAutomationExecutionMetadata(metadata: AutomationMetadata) {
  const execution = metadata?.automation_execution;
  return isRecord(execution) ? execution : null;
}

function defaultStatusLabel(status: string) {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "streaming":
      return "Streaming";
    case "success":
      return "Success";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function isTimeoutMessage(error: string | null | undefined) {
  if (typeof error !== "string") return false;
  return /timeout|timed out|headers timeout|body timeout|connect timeout/i.test(
    error
  );
}

export function readAutomationFailureClass(metadata: AutomationMetadata) {
  const direct = readOptionalString(metadata?.model_failure_class);
  if (direct) return direct;

  const execution = readAutomationExecutionMetadata(metadata);
  return readOptionalString(execution?.finalFailureClass);
}

export function readAutomationTimeoutBudgetMs(metadata: AutomationMetadata) {
  const direct = readOptionalNumber(metadata?.model_effective_timeout_ms);
  if (direct != null) return direct;

  const execution = readAutomationExecutionMetadata(metadata);
  return readOptionalNumber(execution?.effectiveTimeoutMs);
}

export function getAutomationStatusPresentation(input: {
  status: string;
  metadata?: AutomationMetadata;
  error?: string | null;
}): AutomationStatusPresentation {
  const failureClass = readAutomationFailureClass(input.metadata);
  const isTimedOut =
    input.status === "failed" &&
    (failureClass === "timeout" || isTimeoutMessage(input.error));

  return {
    label: isTimedOut ? "Timed out" : defaultStatusLabel(input.status),
    isTimedOut,
    failureClass,
    timeoutBudgetMs: isTimedOut
      ? readAutomationTimeoutBudgetMs(input.metadata)
      : null,
  };
}

export function getAutomationCostState(input: {
  status: string;
  costUsd: number | null | undefined;
  costSource?: AutomationCostSource;
}): AutomationCostState {
  if (
    input.status === "success" &&
    input.costSource === "gateway" &&
    input.costUsd != null
  ) {
    return "reconciled";
  }

  if (input.status === "success") {
    return input.costUsd == null ? "missing" : "known";
  }

  if (input.costUsd == null) {
    return "unknown";
  }

  // Any non-success run with observed spend is necessarily incomplete usage,
  // including active streaming calls that have accrued partial cost already.
  return "partial";
}

export function getAutomationCostPrimaryLabel(input: {
  costState: AutomationCostState;
  costUsd: number | null | undefined;
}) {
  switch (input.costState) {
    case "unknown":
    case "missing":
      return "—";
    default:
      return formatAutomationCostUsd(input.costUsd);
  }
}

export function getAutomationCostSecondaryLabel(
  costState: AutomationCostState
) {
  switch (costState) {
    case "partial":
      return "partial";
    case "missing":
      return "success without cost";
    default:
      return null;
  }
}

function formatAutomationCostUsd(cost: number | null | undefined): string {
  if (cost == null) return "—";
  if (cost === 0) return "$0.00";
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

function formatRoundedBudgetValue(
  value: number,
  nextUnitThreshold: number | null
) {
  const rounded = Number(value.toFixed(1));
  const normalized =
    nextUnitThreshold != null && rounded >= nextUnitThreshold
      ? Math.floor(value * 10) / 10
      : rounded;

  return Number.isInteger(normalized)
    ? normalized.toFixed(0)
    : normalized.toFixed(1);
}

export function formatAutomationTimeoutBudgetLabel(
  timeoutBudgetMs: number | null | undefined
) {
  if (
    typeof timeoutBudgetMs !== "number" ||
    !Number.isFinite(timeoutBudgetMs) ||
    timeoutBudgetMs <= 0
  ) {
    return null;
  }

  if (timeoutBudgetMs < 1_000) {
    return `${timeoutBudgetMs}ms budget`;
  }

  if (timeoutBudgetMs < 60_000) {
    const seconds = timeoutBudgetMs / 1_000;
    return `${formatRoundedBudgetValue(seconds, 60)}s budget`;
  }

  if (timeoutBudgetMs < 3_600_000) {
    const minutes = timeoutBudgetMs / 60_000;
    return `${formatRoundedBudgetValue(minutes, 60)}m budget`;
  }

  const hours = timeoutBudgetMs / 3_600_000;
  return `${formatRoundedBudgetValue(hours, null)}h budget`;
}
