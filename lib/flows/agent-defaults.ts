export const FLOW_AGENT_DEFAULT_MAX_STEPS = 100;

export function getEffectiveFlowAgentMaxSteps(
  value: number | null | undefined
) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return FLOW_AGENT_DEFAULT_MAX_STEPS;
  }
  return Math.max(1, Math.floor(value));
}
