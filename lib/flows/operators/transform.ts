import { FAILURE_HANDLE_ID } from "@/lib/flows/graph-helpers";
import type {
  FlowNode,
  FlowTransformAssignment,
  FlowTransformOperation,
} from "@/lib/types";
import { resolveFlowStatePath } from "./state";
import type { FlowOperatorDefinition } from "./types";

type TransformNode = Extract<FlowNode, { type: "transform" }>;

const KEY_PATTERN = /^[a-zA-Z_]\w*$/;
const SOURCE_PATTERN = /^[a-zA-Z_]\w*(?:\.\w+)*$/;
const TRANSFORM_OPERATIONS: ReadonlySet<FlowTransformOperation> = new Set([
  "copy",
  "string_contains",
  "string_split",
  "array_join",
  "array_length",
  "array_includes",
  "files_match_glob",
  "cast_boolean",
  "cast_number",
]);
const OPERATIONS_REQUIRING_ARGUMENT: ReadonlySet<FlowTransformOperation> =
  new Set([
    "string_contains",
    "string_split",
    "array_join",
    "array_includes",
    "files_match_glob",
  ]);
const OPERATIONS_REQUIRING_NONEMPTY_ARGUMENT: ReadonlySet<FlowTransformOperation> =
  new Set(["string_contains", "array_includes", "files_match_glob"]);

type GlobToken =
  | { kind: "literal"; value: string }
  | { kind: "question" }
  | { kind: "star" }
  | { kind: "globstar" }
  | { kind: "globstar_slash_boundary" }
  | { kind: "globstar_slash_segment" };

function isTransformOperation(value: unknown): value is FlowTransformOperation {
  return TRANSFORM_OPERATIONS.has(value as FlowTransformOperation);
}

function coerceAssignments(raw: unknown): FlowTransformAssignment[] {
  if (!Array.isArray(raw)) return [];
  const assignments: FlowTransformAssignment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key.trim() : "";
    const source =
      typeof record.source === "string" ? record.source.trim() : "";
    if (!key || !source) continue;
    assignments.push({
      key,
      source,
      // Preserve invalid boundary input so graph validation rejects it rather
      // than silently changing the requested operation to `copy`.
      operation:
        typeof record.operation === "string"
          ? (record.operation as FlowTransformOperation)
          : ("" as FlowTransformOperation),
      ...(typeof record.argument === "string"
        ? { argument: record.argument }
        : {}),
    });
  }
  return assignments;
}

function sourceType(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function requireString(
  assignment: FlowTransformAssignment,
  value: unknown
): string {
  if (typeof value === "string") return value;
  throw new Error(
    `"${assignment.source}" must resolve to a string for ${assignment.operation}; received ${sourceType(value)}`
  );
}

function requireArray(
  assignment: FlowTransformAssignment,
  value: unknown
): unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error(
    `"${assignment.source}" must resolve to an array for ${assignment.operation}; received ${sourceType(value)}`
  );
}

function castBoolean(assignment: FlowTransformAssignment, value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }
  throw new Error(
    `"${assignment.source}" cannot be cast to a boolean from ${sourceType(value)}`
  );
}

function castNumber(assignment: FlowTransformAssignment, value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(
    `"${assignment.source}" cannot be cast to a finite number from ${sourceType(value)}`
  );
}

function tokenizeGlob(pattern: string): GlobToken[] {
  const characters = Array.from(pattern);
  const tokens: GlobToken[] = [];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === "*" && characters[index + 1] === "*") {
      const startsSegment = index === 0 || characters[index - 1] === "/";
      const followedBySlash = characters[index + 2] === "/";
      const endsSegment = index + 2 === characters.length || followedBySlash;
      if (startsSegment && followedBySlash) {
        tokens.push(
          { kind: "globstar_slash_boundary" },
          { kind: "globstar_slash_segment" }
        );
        index += 2;
      } else if (startsSegment && endsSegment) {
        tokens.push({ kind: "globstar" });
        index += 1;
      } else {
        // Outside a complete path segment, consecutive stars retain ordinary
        // `*` semantics and cannot consume `/`.
        tokens.push({ kind: "star" });
        index += 1;
      }
    } else if (character === "*") {
      tokens.push({ kind: "star" });
    } else if (character === "?") {
      tokens.push({ kind: "question" });
    } else {
      tokens.push({ kind: "literal", value: character });
    }
  }
  return tokens;
}

function addGlobEpsilonTransitions(
  states: Uint8Array,
  tokens: ReadonlyArray<GlobToken>
) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (!states[index]) continue;
    const token = tokens[index];
    if (token.kind === "star" || token.kind === "globstar") {
      states[index + 1] = 1;
    } else if (token.kind === "globstar_slash_boundary") {
      states[index + 2] = 1;
    }
  }
}

function globMatches(value: string, tokens: ReadonlyArray<GlobToken>) {
  let states = new Uint8Array(tokens.length + 1);
  states[0] = 1;
  addGlobEpsilonTransitions(states, tokens);

  for (const character of value) {
    const nextStates = new Uint8Array(tokens.length + 1);
    for (let index = 0; index < tokens.length; index += 1) {
      if (!states[index]) continue;
      const token = tokens[index];
      switch (token.kind) {
        case "literal":
          if (character === token.value) nextStates[index + 1] = 1;
          break;
        case "question":
          if (character !== "/") nextStates[index + 1] = 1;
          break;
        case "star":
          if (character !== "/") nextStates[index] = 1;
          break;
        case "globstar":
          nextStates[index] = 1;
          break;
        case "globstar_slash_boundary":
          nextStates[character === "/" ? index : index + 1] = 1;
          break;
        case "globstar_slash_segment":
          nextStates[character === "/" ? index - 1 : index] = 1;
          break;
      }
    }
    addGlobEpsilonTransitions(nextStates, tokens);
    states = nextStates;
  }

  return states[tokens.length] === 1;
}

function filesMatchGlob(values: unknown[], pattern: string) {
  const tokens = tokenizeGlob(pattern);
  return values.some(
    (entry) => typeof entry === "string" && globMatches(entry, tokens)
  );
}

export function applyFlowTransform(
  assignment: FlowTransformAssignment,
  value: unknown
): unknown {
  const argument = assignment.argument ?? "";
  switch (assignment.operation) {
    case "copy":
      return value;
    case "string_contains":
      return requireString(assignment, value).includes(argument);
    case "string_split":
      return requireString(assignment, value).split(argument);
    case "array_join":
      return requireArray(assignment, value)
        .map((entry) => String(entry ?? ""))
        .join(argument);
    case "array_length":
      return requireArray(assignment, value).length;
    case "array_includes":
      return requireArray(assignment, value).some(
        (entry) => String(entry) === argument
      );
    case "files_match_glob":
      return filesMatchGlob(requireArray(assignment, value), argument);
    case "cast_boolean":
      return castBoolean(assignment, value);
    case "cast_number":
      return castNumber(assignment, value);
    default:
      throw new Error(
        `"${assignment.source}" uses unsupported operation "${String(assignment.operation)}"`
      );
  }
}

export const transformOperator: FlowOperatorDefinition<TransformNode> = {
  type: "transform",
  canFail: true,
  validate: ({ node, inbound, outbound }) => {
    const errors: string[] = [];
    if (inbound.length === 0) {
      errors.push(
        `Transform node "${node.data.label}" must have at least one incoming edge.`
      );
    }
    const successEdges = outbound.filter(
      (edge) => edge.sourceHandle !== FAILURE_HANDLE_ID
    );
    if (successEdges.length === 0) {
      errors.push(
        `Transform node "${node.data.label}" must have at least one outgoing edge.`
      );
    }
    if (node.data.assignments.length === 0) {
      errors.push(
        `Transform node "${node.data.label}" must define at least one transformation.`
      );
    }

    const seen = new Set<string>();
    for (const assignment of node.data.assignments) {
      if (!KEY_PATTERN.test(assignment.key)) {
        errors.push(
          `Transform node "${node.data.label}" has invalid key "${assignment.key}".`
        );
      } else if (seen.has(assignment.key)) {
        errors.push(
          `Transform node "${node.data.label}" assigns "${assignment.key}" more than once.`
        );
      }
      seen.add(assignment.key);

      if (!SOURCE_PATTERN.test(assignment.source)) {
        errors.push(
          `Transform node "${node.data.label}" has invalid source path "${assignment.source}".`
        );
      }
      if (!isTransformOperation(assignment.operation)) {
        errors.push(
          `Transform node "${node.data.label}" has unsupported operation "${String(assignment.operation)}".`
        );
      } else if (
        OPERATIONS_REQUIRING_ARGUMENT.has(assignment.operation) &&
        assignment.argument === undefined
      ) {
        errors.push(
          `Transform node "${node.data.label}" requires an argument for ${assignment.operation}.`
        );
      } else if (
        OPERATIONS_REQUIRING_NONEMPTY_ARGUMENT.has(assignment.operation) &&
        !assignment.argument?.length
      ) {
        errors.push(
          `Transform node "${node.data.label}" requires a non-empty argument for ${assignment.operation}.`
        );
      }
    }
    return errors;
  },
  coerceData: (raw) => ({
    label: typeof raw.label === "string" ? raw.label : "Transform",
    assignments: coerceAssignments(raw.assignments),
  }),
  defaultData: (input) => ({
    label: input.label?.trim() || `Transform ${input.nextIndex}`,
    assignments: [
      {
        key: "",
        source: "metadata.changed_files",
        operation: "array_length",
      },
    ],
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
        "Transform skipped because every incoming branch was skipped"
      );
    }

    const resolved: Array<FlowTransformAssignment & { value: unknown }> = [];
    for (const assignment of node.data.assignments) {
      const sourceValue = resolveFlowStatePath(
        resolutionState,
        assignment.source
      );
      if (sourceValue === undefined) {
        const message = `Transform "${label}" could not resolve "${assignment.source}"`;
        await completeNodeRun({ status: "failed", error: message });
        return { ok: false, message };
      }
      try {
        resolved.push({
          ...assignment,
          value: applyFlowTransform(assignment, sourceValue),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const message = `Transform "${label}" failed: ${detail}`;
        await completeNodeRun({ status: "failed", error: message });
        return { ok: false, message };
      }
    }

    for (const transformation of resolved) {
      flowState.set(transformation.key, transformation.value);
    }
    const summary = `${label} wrote ${resolved.map((entry) => entry.key).join(", ")}`;
    outputs.set(node.id, { label, text: summary });
    await completeNodeRun({
      status: "success",
      output: { transformations: resolved },
    });
    return {
      ok: true,
      emitted: emit(label, summary, {
        payload: {
          state: Object.fromEntries(
            resolved.map((entry) => [entry.key, entry.value])
          ),
        },
      }),
    };
  },
};
