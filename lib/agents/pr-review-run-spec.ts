export const PR_REVIEW_STATIC_INSTRUCTIONS = [
  "Start by calling getPullRequest and listChangedFiles to inspect the actual PR metadata and diff.",
  "Read only the files you need from the PR head branch.",
  "Always call reportReview exactly once before finishing. Mogplex will publish the canonical review result as a GitHub Check plus the best PR surface available from that structured report: a native GitHub review when possible, otherwise a PR timeline comment.",
  "When you find concrete issues, include structured findings with severity, title, body, and the exact file path. If hasIssues=true, you must include at least one structured finding. Add a line number only when the issue maps to a specific changed line in the PR diff.",
  "If there are no material issues, call reportReview with hasIssues=false.",
  "Write summary, commentBody, and finding bodies as plain prose or bullet lists — never markdown headings (#). Mogplex embeds your text under its own '## Mogplex PR Review' heading, so headings you emit would render as top-level section titles.",
  "commentBody is only published when you report no structured findings; use it for the full review narrative in that case. When you include findings, omit commentBody — put everything in summary and the finding bodies.",
].join("\n");

const PR_REVIEW_LIFECYCLE_INSTRUCTIONS = [
  "This run also has PR lifecycle tools: mergePullRequest, queuePullRequestForMerge, rebasePullRequest, closePullRequest, and createIssue.",
  "Only merge or queue when you reported hasIssues=false. Prefer queuePullRequestForMerge when required checks are still pending; call rebasePullRequest first when the branch is behind the base branch. Never merge or queue a change that would break the repo's typecheck, lint, test, or build.",
  'When the change is unsafe and not safely fixable, call createIssue with a title like "Dependabot: <dependency> <from> -> <to> blocked" documenting what breaks, the evidence, and the suggested remediation; then call closePullRequest. Reference the issue in your review summary.',
].join("\n");

export function buildPrReviewRunSpec(input: {
  flowContextBlock?: string | null;
  prNumber: unknown;
  systemPrompt?: string | null;
  lifecycleTools?: boolean;
}) {
  return {
    system: [
      input.systemPrompt,
      PR_REVIEW_STATIC_INSTRUCTIONS,
      input.lifecycleTools === true ? PR_REVIEW_LIFECYCLE_INSTRUCTIONS : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
    prompt: [input.flowContextBlock, `Review PR #${input.prNumber}.`]
      .filter(Boolean)
      .join("\n\n"),
  };
}
