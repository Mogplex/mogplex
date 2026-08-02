// Allowlist of fields a client can set when creating an agent. Columns like
// id, user_id, and created_at are server- or database-controlled and must
// never be accepted from the request body.
export const AGENT_CREATE_FIELDS = [
  "name",
  "model",
  "system_prompt",
  "description",
  "category",
  "source_template",
] as const;

// Update allowlist is stricter: source_template is fork-time only and must
// not be rewritten after creation.
export const AGENT_UPDATE_FIELDS = [
  "name",
  "model",
  "system_prompt",
  "description",
  "category",
] as const;

const STRING_TRIM_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "model",
  "category",
]);

export type AgentCreateField = (typeof AGENT_CREATE_FIELDS)[number];
export type AgentUpdateField = (typeof AGENT_UPDATE_FIELDS)[number];

export function pickAgentFields<K extends string>(
  body: unknown,
  allowed: readonly K[]
): Record<K, unknown> {
  const out: Record<string, unknown> = {};
  if (!body || typeof body !== "object") return out as Record<K, unknown>;
  const source = body as Record<string, unknown>;
  for (const key of allowed) {
    if (!Object.hasOwn(source, key)) continue;
    const value = source[key];
    out[key] =
      typeof value === "string" && STRING_TRIM_FIELDS.has(key)
        ? value.trim()
        : value;
  }
  return out as Record<K, unknown>;
}
