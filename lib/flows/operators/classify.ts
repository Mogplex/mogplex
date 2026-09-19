import type {
  FlowClassifyOption,
  FlowClassifyOutput,
  FlowClassifyResult,
  FlowEdge,
  FlowNode,
} from "@/lib/types";
import {
  CLASSIFY_UNCERTAIN_HANDLE_ID,
  CONDITION_HANDLE_IDS,
  FAILURE_HANDLE_ID,
  classifyOptionHandleId,
} from "@/lib/flows/graph-helpers";
import { resolveTemplate } from "./state";
import type { FlowOperatorDefinition } from "./types";

type ClassifyNode = Extract<FlowNode, { type: "classify" }>;

const KEY_PATTERN = /^[a-zA-Z_]\w*$/;
const OPTION_ID_PATTERN = /^[\w-]+$/;
// Limits of the evaluation model, not product limits.
export const CLASSIFY_MAX_OPTIONS = 255;
export const CLASSIFY_MAX_LEVELS = 10;
export const CLASSIFY_DEFAULT_INPUT = "{{previous_outputs}}";

export const CLASSIFY_DEFAULT_LEVELS = ["low", "medium", "high"];

function slugify(label: string, fallback: string) {
  const slug = label
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  return slug || fallback;
}

function coerceOptions(raw: unknown): FlowClassifyOption[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const options: FlowClassifyOption[] = [];
  for (const [index, entry] of raw.entries()) {
    // The public API accepts a bare label; ids are derived when missing.
    const record =
      typeof entry === "string"
        ? { label: entry }
        : entry && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : null;
    if (!record) continue;
    const label = typeof record.label === "string" ? record.label : "";
    const wanted =
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : slugify(label, `option_${index + 1}`);
    let id = wanted;
    let suffix = 2;
    while (used.has(id)) {
      id = `${wanted}_${suffix}`;
      suffix += 1;
    }
    used.add(id);
    const description =
      typeof record.description === "string" ? record.description : "";
    options.push({ id, label, ...(description ? { description } : {}) });
  }
  return options;
}

function coerceOutput(raw: unknown): FlowClassifyOutput {
  const record =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (record.kind === "choice") {
    return { kind: "choice", options: coerceOptions(record.options) };
  }
  if (record.kind === "scale") {
    const levels = Array.isArray(record.levels)
      ? record.levels.filter(
          (level): level is string => typeof level === "string"
        )
      : [];
    return { kind: "scale", levels };
  }
  return { kind: "boolean" };
}

function coerceMinConfidence(raw: unknown): number | null {
  const value = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The handle an answer leaves through. A scale uses the default handle. */
export function classifyResultHandle(
  result: FlowClassifyResult
): string | null {
  if (result.uncertain) return CLASSIFY_UNCERTAIN_HANDLE_ID;
  if (result.kind === "boolean") {
    return result.answer === true
      ? CONDITION_HANDLE_IDS.true
      : CONDITION_HANDLE_IDS.false;
  }
  if (result.kind === "choice") {
    return classifyOptionHandleId(result.optionId ?? "");
  }
  return null;
}

/** Answer handles a classify node must wire, by output kind. */
export function classifyAnswerHandles(output: FlowClassifyOutput): string[] {
  if (output.kind === "boolean") {
    return [CONDITION_HANDLE_IDS.true, CONDITION_HANDLE_IDS.false];
  }
  if (output.kind === "choice") {
    return output.options.map((option) => classifyOptionHandleId(option.id));
  }
  return [];
}

/** Option and level rules, shared by graph validation and the test route. */
export function validateClassifyOutput(
  name: string,
  output: FlowClassifyOutput
): string[] {
  const errors: string[] = [];
  if (output.kind === "choice") {
    const { options } = output;
    if (options.length < 2 || options.length > CLASSIFY_MAX_OPTIONS) {
      errors.push(
        `${name} must define between 2 and ${CLASSIFY_MAX_OPTIONS} options.`
      );
    }
    if (options.some((option) => !option.label.trim())) {
      errors.push(`${name} must give every option a label.`);
    }
    if (options.some((option) => !OPTION_ID_PATTERN.test(option.id))) {
      errors.push(
        `${name} option ids may only contain letters, digits, underscores, and dashes.`
      );
    }
    const labels = options.map((option) => option.label.trim().toLowerCase());
    if (new Set(labels).size !== labels.length) {
      errors.push(`${name} has two options with the same label.`);
    }
    if (new Set(options.map((option) => option.id)).size !== options.length) {
      errors.push(`${name} has two options with the same id.`);
    }
  }
  if (output.kind === "scale") {
    const { levels } = output;
    if (levels.length < 2 || levels.length > CLASSIFY_MAX_LEVELS) {
      errors.push(
        `${name} must define between 2 and ${CLASSIFY_MAX_LEVELS} scale levels.`
      );
    }
    if (levels.some((level) => !level.trim())) {
      errors.push(`${name} must describe every scale level.`);
    }
  }
  return errors;
}

function validateEdges(
  name: string,
  data: ClassifyNode["data"],
  outbound: FlowEdge[]
): string[] {
  const errors: string[] = [];
  const handles = outbound
    .map((edge) => edge.sourceHandle ?? null)
    .filter((handle) => handle !== FAILURE_HANDLE_ID);
  const wired = new Set(handles);
  const answerHandles = classifyAnswerHandles(data.output);
  const floorSet = data.minConfidence != null;

  if (data.output.kind === "scale") {
    if (!wired.has(null)) {
      errors.push(`${name} must have at least one outgoing edge.`);
    }
  } else if (answerHandles.some((handle) => !wired.has(handle))) {
    errors.push(
      data.output.kind === "boolean"
        ? `${name} must wire both the true and false branches.`
        : `${name} must wire a branch for every option.`
    );
  }

  // An uncertain edge without a floor gets its own, clearer error below.
  const allowed = new Set<string | null>([
    ...(data.output.kind === "scale" ? [null] : answerHandles),
    CLASSIFY_UNCERTAIN_HANDLE_ID,
  ]);
  if (wired.has(CLASSIFY_UNCERTAIN_HANDLE_ID) && !floorSet) {
    errors.push(
      `${name} wires an uncertain branch but sets no minimum confidence.`
    );
  } else if (handles.some((handle) => !allowed.has(handle))) {
    errors.push(`${name} has an edge from a branch that no longer exists.`);
  }
  if (floorSet && !wired.has(CLASSIFY_UNCERTAIN_HANDLE_ID)) {
    errors.push(
      `${name} sets a minimum confidence, so it must wire the uncertain branch.`
    );
  }
  return errors;
}

function describe(result: FlowClassifyResult): string {
  const confidence = `${Math.round(result.confidence * 100)}% confidence`;
  const answer =
    result.kind === "scale"
      ? `${result.answer} (${result.level})`
      : String(result.answer);
  return result.uncertain
    ? `uncertain: leaned ${answer} at ${confidence}`
    : `${answer} at ${confidence}`;
}

export const classifyOperator: FlowOperatorDefinition<ClassifyNode> = {
  type: "classify",
  canFail: true,
  validate: ({ node, inbound, outbound }) => {
    const { data } = node;
    const name = `Classify "${data.label}"`;
    const errors: string[] = [];
    if (inbound.length === 0) {
      errors.push(`${name} must have at least one incoming edge.`);
    }
    if (!data.question.trim()) errors.push(`${name} must ask a question.`);
    if (!data.input.trim()) {
      errors.push(`${name} must define the state to judge.`);
    }
    if (!KEY_PATTERN.test(data.resultKey)) {
      errors.push(
        `${name} has invalid result variable "${data.resultKey}". Names must start with a letter or underscore and contain only letters, digits, and underscores.`
      );
    }
    const floor = data.minConfidence;
    if (floor != null && !(floor > 0 && floor < 1)) {
      errors.push(`${name} minimum confidence must be between 0 and 1.`);
    }
    return [
      ...errors,
      ...validateClassifyOutput(name, data.output),
      ...validateEdges(name, data, outbound),
    ];
  },
  coerceData: (raw) => ({
    label: typeof raw.label === "string" ? raw.label : "Classify",
    input: typeof raw.input === "string" ? raw.input : CLASSIFY_DEFAULT_INPUT,
    question: typeof raw.question === "string" ? raw.question : "",
    output: coerceOutput(raw.output),
    resultKey: typeof raw.resultKey === "string" ? raw.resultKey.trim() : "",
    minConfidence: coerceMinConfidence(raw.minConfidence),
  }),
  defaultData: (input) => ({
    label: input.label?.trim() || `Classify ${input.nextIndex}`,
    input: CLASSIFY_DEFAULT_INPUT,
    question: "",
    output: { kind: "boolean" },
    resultKey: `classify_${input.nextIndex}`,
    minConfidence: null,
  }),
  execute: async ({
    node,
    label,
    shouldSkip,
    outputs,
    flowState,
    resolutionState,
    completeNodeRun,
    completeSkipped,
    emit,
    classifier,
    jobRunId,
  }) => {
    if (shouldSkip) {
      return completeSkipped(
        "Classify skipped because every incoming branch was skipped"
      );
    }
    const resolved = resolveTemplate(node.data.input, resolutionState);
    const isEmpty =
      resolved == null ||
      (typeof resolved === "string" && !resolved.trim()) ||
      (Array.isArray(resolved) && resolved.length === 0);
    // The executor routes a failure but does not record it; the operator does.
    const fail = async (message: string) => {
      await completeNodeRun({ status: "failed", error: message });
      return { ok: false as const, message };
    };
    if (isEmpty) {
      return fail(
        `Classify "${label}" has nothing to judge: its state resolved to empty.`
      );
    }
    const state =
      typeof resolved === "object"
        ? (resolved as Record<string, unknown> | unknown[])
        : String(resolved);

    const outcome = await classifier({
      jobRunId,
      nodeId: node.id,
      nodeLabel: label,
      question: node.data.question,
      output: node.data.output,
      state,
      minConfidence: node.data.minConfidence ?? null,
    });
    if (!outcome.ok) return fail(outcome.message);

    const { result } = outcome;
    const chosen = classifyResultHandle(result);
    const summary = `${label}: ${describe(result)}`;
    flowState.set(node.data.resultKey, result);
    outputs.set(node.id, { label, text: summary });
    await completeNodeRun({
      status: "success",
      output: { question: node.data.question, ...result, branch: chosen },
    });

    const takesBranch = (edge: FlowEdge) =>
      (edge.sourceHandle ?? null) === chosen;
    return {
      ok: true,
      emitted: [
        ...emit(label, summary, {
          payload: { classification: result },
          selector: takesBranch,
        }),
        ...emit(label, `${label} did not take this branch`, {
          skipped: true,
          selector: (edge) => !takesBranch(edge),
        }),
      ],
    };
  },
};
