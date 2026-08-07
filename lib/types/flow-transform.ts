/**
 * Flow transform and set-variable node types.
 */

export type FlowSetVariableAssignment = {
  // Variable name. Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/. Persisted into the
  // run's flow state map and exposed to downstream conditions as `state.<key>`.
  key: string;
  // Mustache-style template. Whole-string single-substitution preserves the
  // resolved value's native type (number stays number, array stays array).
  // Mixed text interpolates resolved values as strings.
  template: string;
};

export type FlowSetVariableNodeData = {
  label: string;
  assignments: FlowSetVariableAssignment[];
};

export type FlowTransformOperation =
  | "copy"
  | "string_contains"
  | "string_split"
  | "array_join"
  | "array_length"
  | "array_includes"
  | "files_match_glob"
  | "cast_boolean"
  | "cast_number";

export type FlowTransformAssignment = {
  // Variable name written into per-run state and exposed downstream as
  // `state.<key>`.
  key: string;
  // Dot-path into metadata, repo, outputs, outputs_by_label,
  // previous_outputs, or state.
  source: string;
  operation: FlowTransformOperation;
  // Operation-specific input: substring, delimiter, array value, or glob.
  // Copy, length, and cast operations do not use it.
  argument?: string;
};

export type FlowTransformNodeData = {
  label: string;
  assignments: FlowTransformAssignment[];
};
