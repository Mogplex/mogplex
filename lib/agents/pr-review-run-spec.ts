export const PR_REVIEW_STATIC_INSTRUCTIONS = [
  "Start by calling getPullRequest and listChangedFiles to inspect the actual PR metadata and diff.",
  "Read only the files you need from the PR head branch.",
  "Always call reportReview exactly once before finishing. Mogplex will publish the canonical review result as a GitHub Check plus the best PR surface available from that structured report: a native GitHub review when possible, otherwise a PR timeline comment.",
  "When you find concrete issues, include structured findings with severity, title, body, and the exact file path. If hasIssues=true, you must include at least one structured finding. Add a line number only when the issue maps to a specific changed line in the PR diff.",
  "If there are no material issues, call reportReview with hasIssues=false.",
  "Write summary, commentBody, and finding bodies as plain prose or bullet lists — never markdown headings (#). Mogplex embeds your text under its own '## Mogplex PR Review' heading, so headings you emit would render as top-level section titles.",
  "commentBody is only published when you report no structured findings; use it for the full review narrative in that case. When you include findings, omit commentBody — put everything in summary and the finding bodies.",
].join("\n");

export function buildPrReviewRunSpec(input: {
  flowContextBlock?: string | null;
  prNumber: number;
  systemPrompt?: string | null;
}) {
  return {
    system: [input.systemPrompt, PR_REVIEW_STATIC_INSTRUCTIONS]
      .filter(Boolean)
      .join("\n\n"),
    prompt: [input.flowContextBlock, `Review PR #${input.prNumber}.`]
      .filter(Boolean)
      .join("\n\n"),
  };
}
