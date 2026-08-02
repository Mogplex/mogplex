import type {
  FlowConditionOperator,
  FlowConditionRule,
  FlowConditionRuleMode,
  FlowNode,
} from "@/lib/types";
import {
  CONDITION_HANDLE_IDS,
  FAILURE_HANDLE_ID,
  VALUE_LESS_CONDITION_OPERATORS,
  isConditionOperator,
} from "@/lib/flows/graph-helpers";
import type { FlowOperatorDefinition } from "./types";

type ConditionNode = Extract<FlowNode, { type: "condition" }>;

const RULE_MODES: ReadonlySet<FlowConditionRuleMode> = new Set(["all", "any"]);

function isRuleMode(value: unknown): value is FlowConditionRuleMode {
  return RULE_MODES.has(value as FlowConditionRuleMode);
}

function coerceRule(raw: unknown): FlowConditionRule | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const field = typeof record.field === "string" ? record.field : "";
  const operator = isConditionOperator(record.operator)
    ? record.operator
    : "equals";
  const value = typeof record.value === "string" ? record.value : "";
  return { field, operator, value };
}

function coerceRules(raw: unknown): FlowConditionRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const rule = coerceRule(item);
    return rule ? [rule] : [];
  });
}

// Adapt the legacy `{field, operator, value}` shape that lived directly on the
// node into a single-rule group. New nodes always persist `mode` + `rules`.
function legacyRule(raw: Record<string, unknown>): FlowConditionRule | null {
  if (raw.field === undefined && raw.operator === undefined) return null;
  const field = typeof raw.field === "string" ? raw.field : "";
  const operator: FlowConditionOperator = isConditionOperator(raw.operator)
    ? raw.operator
    : "equals";
  const value = typeof raw.value === "string" ? raw.value : "";
  return { field, operator, value };
}

export const conditionOperator: FlowOperatorDefinition<ConditionNode> = {
  type: "condition",
  canFail: true,
  validate: ({ node, inbound, outbound }) => {
    const errors: string[] = [];
    const label = node.data.label;
    if (inbound.length !== 1)
      errors.push(`If "${label}" must have exactly one incoming edge.`);
    // Error edges live on a separate sourceHandle and are validated by the
    // graph-level canFail / at-most-one rule. The then/else structural check
    // only applies to the success-path edges.
    const branchEdges = outbound.filter(
      (edge) => edge.sourceHandle !== FAILURE_HANDLE_ID
    );
    if (branchEdges.length !== 2)
      errors.push(`If "${label}" must have exactly two outgoing edges.`);
    const handles = new Set(
      branchEdges.map((edge) => edge.sourceHandle ?? null)
    );
    if (
      !handles.has(CONDITION_HANDLE_IDS.true) ||
      !handles.has(CONDITION_HANDLE_IDS.false)
    ) {
      errors.push(`If "${label}" must wire both then and else branches.`);
    }
    if (node.data.rules.length === 0) {
      errors.push(`If "${label}" must define at least one rule.`);
    }
    for (const rule of node.data.rules) {
      if (!rule.field.trim()) {
        errors.push(`If "${label}" must define a source field for every rule.`);
      }
      if (
        !VALUE_LESS_CONDITION_OPERATORS.has(rule.operator) &&
        !rule.value.trim()
      ) {
        errors.push(
          `If "${label}" rule on "${rule.field || "(unset field)"}" must define a compare value.`
        );
      }
    }
    return errors;
  },
  coerceData: (raw) => {
    const label = String(raw.label ?? "If");
    const explicitRules = coerceRules(raw.rules);
    const mode: FlowConditionRuleMode = isRuleMode(raw.mode) ? raw.mode : "all";

    if (explicitRules.length > 0) {
      return { label, mode, rules: explicitRules };
    }

    const fromLegacy = legacyRule(raw);
    if (fromLegacy) {
      return { label, mode, rules: [fromLegacy] };
    }

    return {
      label,
      mode,
      rules: [{ field: "metadata.source_type", operator: "equals", value: "" }],
    };
  },
  defaultData: (input) => ({
    label: input.label?.trim() || `If ${input.nextIndex}`,
    mode: "all",
    rules: [
      {
        field: "metadata.source_type",
        operator: "equals",
        value: "pr_opened",
      },
    ],
  }),
};
