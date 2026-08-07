/**
 * Flow condition node types.
 */

export type FlowConditionOperator =
  | "exists"
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "greater_than"
  | "less_than"
  | "in"
  | "not_in"
  | "is_empty"
  | "is_not_empty";

export type FlowConditionRuleMode = "all" | "any";

export type FlowConditionRule = {
  field: string;
  operator: FlowConditionOperator;
  value: string;
};

export type FlowConditionNodeData = {
  label: string;
  mode: FlowConditionRuleMode;
  rules: FlowConditionRule[];
};
