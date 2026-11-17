const LEAD_LIMIT = 220;

function firstParagraph(summary: string) {
  return (
    summary
      .trim()
      .split(/\n\s*\n/)[0]
      ?.replace(/^#+\s*/, "")
      .trim() ?? ""
  );
}

/** Keep the first block readable; the disclosure retains any truncated text. */
export function checkpointSummaryLead(summary: string) {
  const lead = firstParagraph(summary);
  const characters = Array.from(lead);
  return characters.length > LEAD_LIMIT
    ? `${characters.slice(0, LEAD_LIMIT - 1).join("")}…`
    : lead;
}

/** Avoid repeating a complete short lead when structured details follow it. */
export function checkpointSummaryDetails(summary: string) {
  const paragraphs = summary.trim().split(/\n\s*\n/);
  return paragraphs.length > 1 &&
    Array.from(firstParagraph(summary)).length <= LEAD_LIMIT
    ? paragraphs.slice(1).join("\n\n")
    : summary;
}
