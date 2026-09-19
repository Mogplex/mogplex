import { sanitizeTelemetryValue } from "@/lib/ai-telemetry";

/** The evaluation model accepts 32k tokens of state; stay well inside it. */
export const DECISION_STATE_MAX_CHARS = 60_000;

const STATE_SANITIZE_OPTIONS = {
  maxStringLength: 6000,
  maxItems: 60,
  maxDepth: 6,
} as const;

export type DecisionState = string | Record<string, unknown> | unknown[];

export function clipText(value: unknown, maxChars: number): string {
  const text =
    typeof value === "string" ? value : (JSON.stringify(value ?? "") ?? "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * Prepare state for evaluation and storage: secrets are redacted with the
 * same sanitizer the telemetry pipeline uses, and the whole value is bounded
 * so one oversized tool result cannot exceed the model's state limit.
 */
export function buildDecisionState(value: DecisionState): DecisionState {
  const sanitized = sanitizeTelemetryValue(value, STATE_SANITIZE_OPTIONS);
  const serialized = JSON.stringify(sanitized) ?? "";
  const bounded: DecisionState =
    serialized.length <= DECISION_STATE_MAX_CHARS
      ? (sanitized as DecisionState)
      : {
          truncated: true,
          content: serialized.slice(0, DECISION_STATE_MAX_CHARS),
        };
  return bounded;
}
