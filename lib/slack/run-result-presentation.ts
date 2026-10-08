import { buildAppUrl } from "@/lib/app-url";
import { sanitizeAgentUserFacingText } from "@/lib/agents/user-facing-output";
import { escapeMrkdwn, markdownToMrkdwn } from "./markdown-to-mrkdwn";
import type { SlackBlock } from "./client";
import type {
  RunResultContext,
  RunResultEvidence,
} from "./run-result-evidence";
import type { RunGuidance } from "./run-guidance-store";
import { guidanceReceiptText } from "./run-guidance-presentation";
import { runProgressTitle } from "./run-progress-presentation";
import { progressText } from "./run-progress-state";
import { readRunProgressSnapshot } from "./run-progress-store";

/** User-facing outcomes distinguish observed work from the agent's own claims. */
export function buildRunResultMessage(input: {
  run: RunResultContext;
  status: string;
  output: string | null;
  evidence: RunResultEvidence;
  guidance: readonly RunGuidance[];
}) {
  const { run, status, output, evidence, guidance } = input;
  const title = runProgressTitle({
    id: run.id,
    metadata: run.metadata,
    prompt: run.prompt,
  });
  const result =
    status === "success"
      ? "✅ Run finished · Review results"
      : status === "cancelled"
        ? "⏹️ Run cancelled"
        : "❌ Run failed · Work may be incomplete";
  const snapshot = readRunProgressSnapshot(run.slack_progress);
  const report = closingReport({ status, output, summary: snapshot?.summary });
  const sections = [`*${result}*`];
  if (report)
    sections.push(
      `*${status === "success" ? "Agent’s closing report" : "Last agent update"}${report.excerpt ? " (excerpt)" : ""}*\n${markdownToMrkdwn(report.text)}`
    );
  const checks = [...(snapshot?.tasks.values() ?? [])]
    .filter((task) =>
      ["Running tests", "Checking the build and code quality"].includes(
        task.title
      )
    )
    .slice(-3);
  sections.push(
    checks.length > 0
      ? `*Recorded checks*\n${checks.map((task) => escapeMrkdwn(`${task.title}: ${task.status === "in_progress" ? "No completion recorded" : task.result || "No result recorded"}`)).join("\n")}\nA command result is not an independent verification of the requested behavior.`
      : "*Verification*\nNo completed test or build result was recorded. Check the run details before relying on the agent’s report."
  );
  const github = evidence.github;
  const artifacts = github.pullRequests.map(
    (pr) => `PR #${pr.number} · ${pr.state}\n${escapeMrkdwn(pr.url)}`
  );
  if (github.branch)
    artifacts.push(
      `Remote branch verified at ${github.branch.sha.slice(0, 12)}. Uncommitted changes are not included.\n${escapeMrkdwn(github.branch.url)}`
    );
  if (!github.checked)
    artifacts.push(
      "Could not verify GitHub artifacts. This does not mean the work was lost."
    );
  else if (github.pullRequests.length === 0)
    artifacts.push("No pull request was found for this working branch.");
  sections.push(`*Artifacts*\n${artifacts.join("\n")}`);
  const workspace = evidence.workspace;
  if (workspace) {
    sections.push(
      `*Workspace*\nRecorded as ${escapeMrkdwn(progressText(workspace.status, 40))}${workspace.persistent ? " with persistent storage" : ""}${workspace.snapshotRecorded ? "; a snapshot is recorded" : ""}. Its current availability and contents have not been checked. Inspect the workspace before resuming or starting new work.`
    );
  } else if (status !== "success") {
    sections.push(
      "*Recovery*\nNo recoverable workspace has been verified. Review the run details and any remote branch before retrying. Nothing was restarted automatically."
    );
  }
  const receipts = guidanceReceiptText(guidance);
  if (receipts) sections.push(`*Your guidance*\n${escapeMrkdwn(receipts)}`);
  const runUrl = buildAppUrl(`/runs/${run.id}?view=details`).toString();
  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: title } },
    ...sections.map((text) => ({
      type: "section",
      text: { type: "mrkdwn", text },
    })),
  ];
  const button = (text: string, url: string, action: string) => ({
    type: "button",
    text: { type: "plain_text", text },
    url,
    action_id: action,
  });
  blocks.push({
    type: "actions",
    elements: [
      ...(github.pullRequests[0]
        ? [
            button(
              "Review pull request",
              github.pullRequests[0].url,
              "mogplex-view-pr"
            ),
          ]
        : github.branch
          ? [
              button(
                "Inspect remote branch",
                github.branch.url,
                "mogplex-view-branch"
              ),
            ]
          : []),
      button("View run details", runUrl, "mogplex-view-run"),
      ...(workspace
        ? [
            button(
              "Inspect workspaces",
              buildAppUrl("/sandboxes").toString(),
              "mogplex-view-workspaces"
            ),
          ]
        : []),
    ],
  });
  if (run.working_branch)
    blocks.push({
      type: "context",
      elements: [
        {
          type: "plain_text",
          text: `Branch: ${progressText(run.working_branch, 180)}`,
        },
      ],
    });
  return {
    text: [
      escapeMrkdwn(title),
      ...sections,
      `View run details: ${runUrl}`,
    ].join("\n\n"),
    blocks,
  };
}

const REPORT_EXCERPT_CHARS = 1500;

/**
 * The agent's report keeps its line breaks so its Markdown can be rendered.
 * Secrets are redacted from the whole report before the excerpt is taken, so
 * a cut can never expose part of a credential.
 */
function closingReport(input: {
  status: string;
  output: string | null;
  summary: string | undefined;
}) {
  const full =
    input.status !== "success" && input.summary
      ? input.summary
      : input.output?.trim()
        ? sanitizeAgentUserFacingText(input.output).trim()
        : input.summary;
  if (!full) return null;
  const characters = Array.from(full);
  if (characters.length <= REPORT_EXCERPT_CHARS) {
    return { text: full, excerpt: false };
  }
  const head = characters.slice(0, REPORT_EXCERPT_CHARS - 1).join("");
  const wordEnd = head.search(/\s\S*$/);
  return {
    text: `${(wordEnd > 0 ? head.slice(0, wordEnd) : head).trimEnd()}…`,
    excerpt: true,
  };
}
