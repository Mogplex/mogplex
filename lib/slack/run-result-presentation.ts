import { buildAppUrl } from "@/lib/app-url";
import { sanitizeAgentUserFacingText } from "@/lib/agents/user-facing-output";
import { escapeMrkdwn, markdownToMrkdwn } from "./markdown-to-mrkdwn";
import type { SlackBlock } from "./client";
import { SLACK_RUN_DETAILS_ACTION_ID } from "./command-actions";
import type {
  RunResultContext,
  RunResultEvidence,
} from "./run-result-evidence";
import type { RunGuidance } from "./run-guidance-store";
import { guidanceReceiptText } from "./run-guidance-presentation";
import { runProgressTitle } from "./run-progress-presentation";
import { progressText } from "./run-progress-state";
import { readRunProgressSnapshot } from "./run-progress-store";
import {
  changesSectionText,
  viewChangesButton,
} from "./run-changes-presentation";

export type RunResultInput = {
  run: RunResultContext;
  status: string;
  output: string | null;
  evidence: RunResultEvidence;
  guidance: readonly RunGuidance[];
};

const CHECK_TITLES = new Set([
  "Running tests",
  "Checking the build and code quality",
]);

/** What the card and the details view both say about one result. */
function resultFacts(input: RunResultInput) {
  const { run, status, evidence } = input;
  const snapshot = readRunProgressSnapshot(run.slack_progress);
  const checks = [...(snapshot?.tasks.values() ?? [])]
    .filter((task) => CHECK_TITLES.has(task.title))
    .slice(-3)
    .map((task) =>
      escapeMrkdwn(
        `${task.title}: ${task.status === "in_progress" ? "No completion recorded" : task.result || "No result recorded"}`
      )
    );
  const github = evidence.github;
  return {
    title: runProgressTitle({
      id: run.id,
      metadata: run.metadata,
      prompt: run.prompt,
    }),
    outcome:
      status === "success"
        ? "✅ Run finished · Review results"
        : status === "cancelled"
          ? "⏹️ Run cancelled"
          : "❌ Run failed · Work may be incomplete",
    reportLabel:
      status === "success" ? "Agent’s closing report" : "Last agent update",
    summary: snapshot?.summary,
    checks,
    github,
    branchLine: github.branch
      ? `Remote branch verified at ${github.branch.sha.slice(0, 12)}. Uncommitted changes are not included.`
      : null,
    missingArtifacts: github.checked
      ? github.pullRequests.length === 0
        ? "No pull request was found for this working branch."
        : null
      : "Could not verify GitHub artifacts. This does not mean the work was lost.",
    changes: evidence.changes ? changesSectionText(evidence.changes) : null,
    runUrl: buildAppUrl(`/runs/${run.id}?view=details`).toString(),
  };
}

function reportSection(
  facts: ReturnType<typeof resultFacts>,
  input: RunResultInput,
  budget: number
) {
  const report = closingReport({
    status: input.status,
    output: input.output,
    summary: facts.summary,
    budget,
  });
  return report
    ? `*${facts.reportLabel}${report.excerpt ? " (excerpt)" : ""}*\n${report.mrkdwn}`
    : null;
}

/**
 * The full result, shown behind the card's Details button: the agent's
 * report, recorded checks with their caveat, artifacts, workspace state and
 * guidance receipts. User-facing outcomes distinguish observed work from
 * the agent's own claims.
 */
export function buildRunResultDetails(input: RunResultInput) {
  const facts = resultFacts(input);
  const { github } = facts;
  const sections = [`*${facts.outcome}*`];
  const report = reportSection(facts, input, REPORT_EXCERPT_CHARS);
  if (report) sections.push(report);
  sections.push(
    facts.checks.length > 0
      ? `*Recorded checks*\n${facts.checks.join("\n")}\nA command result is not an independent verification of the requested behavior.`
      : "*Verification*\nNo completed test or build result was recorded. Check the run details before relying on the agent’s report."
  );
  if (facts.changes) sections.push(facts.changes);
  const artifacts = github.pullRequests.map(
    (pr) => `PR #${pr.number} · ${pr.state}\n${escapeMrkdwn(pr.url)}`
  );
  if (github.branch && facts.branchLine)
    artifacts.push(`${facts.branchLine}\n${escapeMrkdwn(github.branch.url)}`);
  if (facts.missingArtifacts) artifacts.push(facts.missingArtifacts);
  sections.push(`*Artifacts*\n${artifacts.join("\n")}`);
  const workspace = input.evidence.workspace;
  if (workspace) {
    sections.push(
      `*Workspace*\nRecorded as ${escapeMrkdwn(progressText(workspace.status, 40))}${workspace.persistent ? " with persistent storage" : ""}${workspace.snapshotRecorded ? "; a snapshot is recorded" : ""}. Its current availability and contents have not been checked. Inspect the workspace before resuming or starting new work.`
    );
  } else if (input.status !== "success") {
    sections.push(
      "*Recovery*\nNo recoverable workspace has been verified. Review the run details and any remote branch before retrying. Nothing was restarted automatically."
    );
  }
  const receipts = guidanceReceiptText(input.guidance);
  if (receipts) sections.push(`*Your guidance*\n${escapeMrkdwn(receipts)}`);
  return {
    title: facts.title,
    sections,
    text: capMessageText(
      [
        escapeMrkdwn(facts.title),
        ...sections,
        `View run details: ${facts.runUrl}`,
      ].join("\n\n")
    ),
  };
}

/**
 * The run card once a run ends: the outcome, a short excerpt of the agent's
 * report, what changed and where it landed, guidance receipts, and one line
 * on checks. The rest is one click away in Details.
 */
export function buildRunResultMessage(input: RunResultInput) {
  const { run, evidence } = input;
  const facts = resultFacts(input);
  const { github } = facts;
  const report = reportSection(facts, input, CARD_REPORT_CHARS);
  const sections = [[`*${facts.outcome}*`, report].filter(Boolean).join("\n")];
  if (facts.changes) sections.push(facts.changes);
  const pr = github.pullRequests[0];
  const artifact = pr
    ? `*Pull request:* <${pr.url}|#${pr.number} · ${pr.state}>`
    : (facts.branchLine ?? facts.missingArtifacts);
  if (artifact) sections.push(artifact);
  // Confirms the user's thread replies reached the agent.
  const receipts = guidanceReceiptText(input.guidance);
  if (receipts) sections.push(`*Your guidance*\n${escapeMrkdwn(receipts)}`);
  const checks =
    facts.checks.length > 0
      ? `Recorded checks: ${facts.checks.join("; ")}. Not an independent verification.`
      : "No completed test or build result was recorded.";
  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: facts.title } },
    ...sections.map((text) => ({
      type: "section",
      text: { type: "mrkdwn", text },
    })),
    { type: "context", elements: [{ type: "mrkdwn", text: checks }] },
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
      ...(pr
        ? [button("Review pull request", pr.url, "mogplex-view-pr")]
        : github.branch
          ? [
              button(
                "Inspect remote branch",
                github.branch.url,
                "mogplex-view-branch"
              ),
            ]
          : []),
      ...(evidence.changes?.length || evidence.workspace
        ? [viewChangesButton(run.id)]
        : []),
      {
        type: "button",
        text: { type: "plain_text", text: "Details" },
        action_id: SLACK_RUN_DETAILS_ACTION_ID,
        value: run.id,
      },
      button("View run details", facts.runUrl, "mogplex-view-run"),
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
    text: capMessageText(
      [
        escapeMrkdwn(facts.title),
        ...sections,
        checks,
        `View run details: ${facts.runUrl}`,
      ].join("\n\n")
    ),
    blocks,
  };
}

/** Details as a modal: one section per part, plus links out. */
export function buildRunResultDetailsModal(
  input: { runId: string } & (
    | { state: "loading" }
    | { state: "message"; text: string }
    | { state: "ready"; details: ReturnType<typeof buildRunResultDetails> }
  )
) {
  const runUrl = buildAppUrl(`/runs/${input.runId}?view=details`).toString();
  const sections =
    input.state === "ready"
      ? input.details.sections
      : [
          input.state === "loading"
            ? "Loading the run’s details…"
            : escapeMrkdwn(input.text),
        ];
  return {
    type: "modal",
    title: { type: "plain_text", text: "Run details" },
    close: { type: "plain_text", text: "Close" },
    private_metadata: input.runId,
    blocks: [
      ...(input.state === "ready"
        ? [
            {
              type: "header",
              text: { type: "plain_text", text: input.details.title },
            },
          ]
        : []),
      ...sections.map((text) => ({
        type: "section",
        text: { type: "mrkdwn", text },
      })),
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `<${runUrl}|View run details> · <${buildAppUrl("/sandboxes").toString()}|Inspect workspaces>`,
          },
        ],
      },
    ],
  };
}

const REPORT_EXCERPT_CHARS = 1500;
const CARD_REPORT_CHARS = 600;
// Slack rejects a section over 3,000 characters and a message whose text is
// over 4,000. Escaping can multiply the report's length, so the rendered
// text is what gets budgeted.
const REPORT_SECTION_CHARS = 2800;
const MESSAGE_TEXT_CHARS = 3900;

function cutAtWord(characters: string[], limit: number) {
  const head = characters.slice(0, limit - 1).join("");
  const wordEnd = head.search(/\s\S*$/);
  return `${(wordEnd > 0 ? head.slice(0, wordEnd) : head).trimEnd()}…`;
}

/**
 * The agent's report keeps its line breaks so its Markdown can be rendered.
 * Secrets are redacted from the whole report before the excerpt is taken, so
 * a cut can never expose part of a credential.
 */
function closingReport(input: {
  status: string;
  output: string | null;
  summary: string | undefined;
  budget: number;
}) {
  const full =
    input.status !== "success" && input.summary
      ? input.summary
      : input.output?.trim()
        ? sanitizeAgentUserFacingText(input.output).trim()
        : input.summary;
  if (!full) return null;
  const characters = Array.from(full);
  let budget = input.budget;
  for (;;) {
    const excerpt = characters.length > budget;
    const mrkdwn = markdownToMrkdwn(
      excerpt ? cutAtWord(characters, budget) : full
    );
    if (mrkdwn.length <= REPORT_SECTION_CHARS || budget <= 2) {
      return { mrkdwn, excerpt };
    }
    // Shrink the source in proportion to how far the rendering overshot.
    budget = Math.max(
      2,
      Math.floor((budget * REPORT_SECTION_CHARS) / mrkdwn.length) - 1
    );
  }
}

function capMessageText(text: string) {
  const characters = Array.from(text);
  return characters.length > MESSAGE_TEXT_CHARS
    ? cutAtWord(characters, MESSAGE_TEXT_CHARS)
    : text;
}
