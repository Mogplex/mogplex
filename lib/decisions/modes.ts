import type { DecisionDefinition, DecisionMode } from "./types";

const MODES = new Set<DecisionMode>(["off", "shadow", "advise", "enforce"]);

function isDecisionMode(value: unknown): value is DecisionMode {
  return typeof value === "string" && MODES.has(value as DecisionMode);
}

/**
 * Parse the `DECISION_MODES` override map, for example
 * `{"command_risk.agent_tool":"enforce","loop_check":"off"}`. Invalid JSON or
 * unknown mode values are ignored so a typo can never enable enforcement.
 */
export function parseDecisionModeOverrides(
  raw: string | undefined
): Record<string, DecisionMode> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const overrides: Record<string, DecisionMode> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (isDecisionMode(value)) overrides[key] = value;
  }
  return overrides;
}

/** Reads `DECISIONS_DISABLED` and `DECISION_MODES`. */
export type DecisionModeEnv = Readonly<Record<string, string | undefined>>;

/**
 * Resolution order: global kill switch, `<id>.<surface>` override, `<id>`
 * override, the definition's per-surface default, then its default.
 */
export function resolveDecisionMode(
  definition: DecisionDefinition,
  surface: string,
  env: DecisionModeEnv = process.env
): DecisionMode {
  if (env.DECISIONS_DISABLED === "1" || env.DECISIONS_DISABLED === "true") {
    return "off";
  }
  const overrides = parseDecisionModeOverrides(env.DECISION_MODES);
  return (
    overrides[`${definition.id}.${surface}`] ??
    overrides[definition.id] ??
    definition.surfaceModes?.[surface] ??
    definition.defaultMode
  );
}
