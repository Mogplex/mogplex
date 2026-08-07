import type { FlowConditionOperator, FlowNode } from "@/lib/types";

function parseNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitListValue(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function rawIsEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

export function evaluateConditionRule(input: {
  rule: { field: string; operator: FlowConditionOperator; value: string };
  state: Record<string, unknown>;
}): boolean {
  const { rule, state } = input;
  const rawValue = resolveFieldPath(state, rule.field);
  const compareValue = rule.value;

  switch (rule.operator) {
    case "exists":
      return (
        rawValue !== undefined &&
        rawValue !== null &&
        String(rawValue).length > 0
      );
    case "is_empty":
      return rawIsEmpty(rawValue);
    case "is_not_empty":
      return !rawIsEmpty(rawValue);
    case "equals":
      return String(rawValue ?? "") === compareValue;
    case "not_equals":
      return String(rawValue ?? "") !== compareValue;
    case "contains": {
      if (Array.isArray(rawValue)) {
        return rawValue.some(
          (entry) => String(entry).toLowerCase() === compareValue.toLowerCase()
        );
      }
      return String(rawValue ?? "")
        .toLowerCase()
        .includes(compareValue.toLowerCase());
    }
    case "not_contains": {
      if (Array.isArray(rawValue)) {
        return !rawValue.some(
          (entry) => String(entry).toLowerCase() === compareValue.toLowerCase()
        );
      }
      return !String(rawValue ?? "")
        .toLowerCase()
        .includes(compareValue.toLowerCase());
    }
    case "starts_with":
      return String(rawValue ?? "")
        .toLowerCase()
        .startsWith(compareValue.toLowerCase());
    case "ends_with":
      return String(rawValue ?? "")
        .toLowerCase()
        .endsWith(compareValue.toLowerCase());
    case "greater_than": {
      const left = parseNumber(String(rawValue ?? ""));
      const right = parseNumber(compareValue);
      return left != null && right != null && left > right;
    }
    case "less_than": {
      const left = parseNumber(String(rawValue ?? ""));
      const right = parseNumber(compareValue);
      return left != null && right != null && left < right;
    }
    case "in": {
      const haystack = splitListValue(compareValue).map((entry) =>
        entry.toLowerCase()
      );
      const needle = String(rawValue ?? "").toLowerCase();
      return haystack.includes(needle);
    }
    case "not_in": {
      const haystack = splitListValue(compareValue).map((entry) =>
        entry.toLowerCase()
      );
      const needle = String(rawValue ?? "").toLowerCase();
      return !haystack.includes(needle);
    }
  }
}

export function evaluateConditionNode(input: {
  node: Extract<FlowNode, { type: "condition" }>;
  state: Record<string, unknown>;
}): boolean {
  const { rules, mode } = input.node.data;
  if (rules.length === 0) return false;

  if (mode === "any") {
    return rules.some((rule) =>
      evaluateConditionRule({ rule, state: input.state })
    );
  }
  return rules.every((rule) =>
    evaluateConditionRule({ rule, state: input.state })
  );
}

export function resolveFieldPath(state: Record<string, unknown>, path: string) {
  if (!path) return;
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== "object") return;
    return (current as Record<string, unknown>)[segment];
  }, state);
}
