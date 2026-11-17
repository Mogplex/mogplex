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

/** Avoid repeating a complete short lead when structured details follow it. */
export function checkpointSummaryDetails(summary: string) {
  const paragraphs = summary.trim().split(/\n\s*\n/);
  return paragraphs.length > 1 && Array.from(paragraphs[0]).length <= 220
    ? paragraphs.slice(1).join("\n\n")
    : summary;
}
