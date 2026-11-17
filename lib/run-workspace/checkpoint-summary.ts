/** A readable lead stays visible; the complete original remains in the disclosure. */
export function checkpointSummaryLead(summary: string) {
  const lead =
    summary
      .trim()
      .split(/\n\s*\n/)[0]
      ?.replace(/^#+\s*/, "")
      .replace(/\s+/g, " ") ?? "";
  const characters = Array.from(lead);
  return characters.length > 220
    ? `${characters.slice(0, 217).join("")}…`
    : lead;
}
