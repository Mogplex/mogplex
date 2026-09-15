export const MODEL_SURFACES = [
  "chat",
  "slack",
  "cli",
  "control",
  "agents",
] as const;
export type ModelSurface = (typeof MODEL_SURFACES)[number];

export const MODEL_SURFACE_LABELS: Record<ModelSurface, string> = {
  chat: "Web chat",
  slack: "Slack agent",
  cli: "CLI",
  control: "Control",
  agents: "Agent presets and API / MCP",
};

export function isModelSurface(value: unknown): value is ModelSurface {
  return (
    typeof value === "string" && new Set<string>(MODEL_SURFACES).has(value)
  );
}

export function surfaceDefaultModel(
  profile:
    | { default_model?: string | null; surface_models?: unknown }
    | null
    | undefined,
  surface?: ModelSurface
): string | null {
  const values = profile?.surface_models;
  if (
    surface &&
    values &&
    typeof values === "object" &&
    !Array.isArray(values)
  ) {
    const model = (values as Record<string, unknown>)[surface];
    if (typeof model === "string" && model.trim()) return model;
  }
  return profile?.default_model ?? null;
}
