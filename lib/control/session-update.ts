const CONTROL_SESSION_UPDATE_FIELDS = [
  "title",
  "project",
  "repo_id",
  "model_id",
  "messages",
  "pinned",
  "archived",
] as const;

export function pickControlSessionUpdateFields(
  body: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    CONTROL_SESSION_UPDATE_FIELDS.flatMap((field) =>
      Object.hasOwn(body, field) ? [[field, body[field]]] : []
    )
  );
}
