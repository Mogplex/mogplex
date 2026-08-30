export const MAX_CONTROL_SESSION_MODEL_ID_LENGTH = 255;

export function parseControlSessionModelId(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CONTROL_SESSION_MODEL_ID_LENGTH) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}
