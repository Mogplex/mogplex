import type { FlowNode, FlowSetVariableAssignment } from "@/lib/types";
import type { FlowOperatorDefinition } from "./types";

type SetVariableNode = Extract<FlowNode, { type: "set_variable" }>;

const KEY_PATTERN = /^[a-zA-Z_]\w*$/;

// Inlined to avoid an `@/lib/flows/graph` ↔ `@/lib/flows/operators/registry`
// import cycle: graph.ts pulls the registry, the registry pulls every
// operator, and an operator that imported from graph.ts would close the loop.
export function resolveFlowStatePath(
  state: Record<string, unknown>,
  path: string
) {
  if (!path) return;
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== "object") return;
    return (current as Record<string, unknown>)[segment];
  }, state);
}

// Whole-string single-substitution: the entire template is exactly one
// {{ path }} expression with no surrounding text. In that case we preserve the
// resolved value's native type (number stays number, array stays array). For
// any other shape — mixed text, multiple substitutions, or no substitutions —
// the result is a plain string.
const WHOLE_SUBSTITUTION = /^\s*\{\{\s*([\w.]+)\s*\}\}\s*$/;
const ANY_SUBSTITUTION = /\{\{\s*([\w.]+)\s*\}\}/g;

function stringifyForInterpolation(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

export function resolveTemplate(
  template: string,
  state: Record<string, unknown>
): unknown {
  const whole = template.match(WHOLE_SUBSTITUTION);
  if (whole) {
    const value = resolveFlowStatePath(state, whole[1]);
    return value === undefined ? null : value;
  }
  if (!template.includes("{{")) return template;
  return template.replace(ANY_SUBSTITUTION, (_, path: string) =>
    stringifyForInterpolation(resolveFlowStatePath(state, path))
  );
}

function coerceAssignments(raw: unknown): FlowSetVariableAssignment[] {
  if (!Array.isArray(raw)) return [];
  const out: FlowSetVariableAssignment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key.trim() : "";
    const template = typeof record.template === "string" ? record.template : "";
    if (key.length === 0) continue;
    out.push({ key, template });
  }
  return out;
}

export const setVariableOperator: FlowOperatorDefinition<SetVariableNode> = {
  type: "set_variable",
  canFail: true,
  validate: ({ node, inbound, outbound }) => {
    const errors: string[] = [];
    if (inbound.length === 0)
      errors.push(
        `Set variable node "${node.data.label}" must have at least one incoming edge.`
      );
    if (outbound.length === 0)
      errors.push(
        `Set variable node "${node.data.label}" must have at least one outgoing edge.`
      );
    const assignments = node.data.assignments ?? [];
    if (assignments.length === 0) {
      errors.push(
        `Set variable node "${node.data.label}" must define at least one assignment.`
      );
    }
    const seen = new Set<string>();
    for (const assignment of assignments) {
      if (!KEY_PATTERN.test(assignment.key)) {
        errors.push(
          `Set variable node "${node.data.label}" has invalid key "${assignment.key}". Keys must start with a letter or underscore and contain only letters, digits, and underscores.`
        );
        continue;
      }
      if (seen.has(assignment.key)) {
        errors.push(
          `Set variable node "${node.data.label}" assigns "${assignment.key}" more than once.`
        );
      }
      seen.add(assignment.key);
    }
    return errors;
  },
  coerceData: (raw) => ({
    label: typeof raw.label === "string" ? raw.label : "Set variable",
    assignments: coerceAssignments(raw.assignments),
  }),
  defaultData: (input) => ({
    label: input.label?.trim() || `Set variable ${input.nextIndex}`,
    assignments: [{ key: "", template: "" }],
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
  }) => {
    if (shouldSkip) {
      return completeSkipped(
        "Set variable skipped because every incoming branch was skipped"
      );
    }
    const resolved = node.data.assignments.map((assignment) => {
      const value = resolveTemplate(assignment.template, resolutionState);
      flowState.set(assignment.key, value);
      return {
        key: assignment.key,
        template: assignment.template,
        value,
      };
    });
    const summary =
      resolved.length === 0
        ? `${label} (no assignments)`
        : `${label} set ${resolved.map((r) => r.key).join(", ")}`;
    outputs.set(node.id, { label, text: summary });
    await completeNodeRun({
      status: "success",
      output: { assignments: resolved },
    });
    return { ok: true, emitted: emit(label, summary) };
  },
};
