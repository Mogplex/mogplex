/**
 * Flow classify node types. A classify node asks one closed question about a
 * piece of run state and routes on the typed answer.
 */

export type FlowClassifyOutputKind = "boolean" | "choice" | "scale";

export type FlowClassifyOption = {
  // Stable id used as the edge sourceHandle (`option:<id>`), so renaming a
  // label never disconnects a branch.
  id: string;
  // The text the evaluation model chooses between. Read literally.
  label: string;
  // Optional guidance on when this option applies.
  description?: string;
};

export type FlowClassifyOutput =
  | { kind: "boolean" }
  | { kind: "choice"; options: FlowClassifyOption[] }
  // Ordered low to high. The answer is a 1-based position on this list.
  | { kind: "scale"; levels: string[] };

export type FlowClassifyNodeData = {
  label: string;
  // Mustache-style template for the state to judge, resolved against the same
  // context as set_variable: metadata, repo, outputs, outputs_by_label,
  // previous_outputs, and state.
  input: string;
  question: string;
  output: FlowClassifyOutput;
  // Variable the result is written to, exposed downstream as
  // `state.<resultKey>.answer`, `.confidence`, and `.probabilities`.
  resultKey: string;
  // When set, an answer below this confidence leaves through the `uncertain`
  // handle instead of an answer branch.
  minConfidence?: number | null;
};

/** What a classify node writes to run state and its node-run output. */
export type FlowClassifyResult = {
  kind: FlowClassifyOutputKind;
  // boolean: true/false. choice: the option label. scale: 1-based position.
  answer: boolean | string | number;
  // choice only: the chosen option id. scale only: the chosen level text.
  optionId?: string;
  level?: string;
  confidence: number;
  probabilities: Record<string, number>;
  uncertain: boolean;
};
