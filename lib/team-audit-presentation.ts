function formatAuditPayloadValue(value: unknown) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? serialized : String(value);
}

export function formatTeamAuditPayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload);
  const visibleEntries = entries.slice(0, 4);
  if (visibleEntries.length === 0) return null;
  const summary = visibleEntries
    .map(([key, value]) => {
      const label = key.replace(/_/g, " ");
      return `${label}: ${formatAuditPayloadValue(value)}`;
    })
    .join(" · ");
  const remainingCount = entries.length - visibleEntries.length;
  return remainingCount > 0 ? `${summary} · +${remainingCount} more` : summary;
}
