import { buildAppUrl } from "@/lib/app-url";
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
      ? "Run finished · Review results"
      : status === "cancelled"
        ? "Run cancelled"
        : "Run failed · Work may be incomplete";
  const snapshot = readRunProgressSnapshot(run.slack_progress);
  const fullReport =
    status !== "success" && snapshot?.summary
      ? snapshot.summary
      : output?.trim()
        ? progressText(output, Number.MAX_SAFE_INTEGER)
        : snapshot?.summary;
  const reportCharacters = Array.from(fullReport ?? "");
  const excerpt = reportCharacters.length > 1500;
  const head = reportCharacters.slice(0, 1499).join("");
  const report = excerpt
    ? `${head.slice(0, head.lastIndexOf(" ") > 0 ? head.lastIndexOf(" ") : head.length).trimEnd()}…`
    : fullReport;
  const paragraphs = [result];
  if (report)
    paragraphs.push(
      `${status === "success" ? "Agent’s closing report" : "Last agent update"}${excerpt ? " (excerpt)" : ""}\n${report}`
    );
  const checks = [...(snapshot?.tasks.values() ?? [])]
    .filter((task) =>
      ["Running tests", "Checking the build and code quality"].includes(
        task.title
      )
    )
    .slice(-3);
  paragraphs.push(
    checks.length > 0
      ? `Recorded checks\n${checks.map((task) => `${task.title}: ${task.status === "in_progress" ? "No completion recorded" : task.result || "No result recorded"}`).join("\n")}\nA command result is not an independent verification of the requested behavior.`
      : "Verification\nNo completed test or build result was recorded. Check the run details before relying on the agent’s report."
  );
  const github = evidence.github;
  const artifacts = github.pullRequests.map(
    (pr) => `PR #${pr.number} · ${pr.state}\n${pr.url}`
  );
  if (github.branch)
    artifacts.push(
      `Remote branch verified at ${github.branch.sha.slice(0, 12)}. Uncommitted changes are not included.\n${github.branch.url}`
    );
  if (!github.checked)
    artifacts.push(
      "Could not verify GitHub artifacts. This does not mean the work was lost."
    );
  else if (github.pullRequests.length === 0)
    artifacts.push("No pull request was found for this working branch.");
  paragraphs.push(`Artifacts\n${artifacts.join("\n")}`);
  const workspace = evidence.workspace;
  if (workspace) {
    paragraphs.push(
      `Workspace\nRecorded as ${progressText(workspace.status, 40)}${workspace.persistent ? " with persistent storage" : ""}${workspace.snapshotRecorded ? "; a snapshot is recorded" : ""}. Its current availability and contents have not been checked. Inspect the workspace before resuming or starting new work.`
    );
  } else if (status !== "success") {
    paragraphs.push(
      "Recovery\nNo recoverable workspace has been verified. Review the run details and any remote branch before retrying. Nothing was restarted automatically."
    );
  }
  const receipts = guidanceReceiptText(guidance);
  if (receipts) paragraphs.push(`Your guidance\n${receipts}`);
  const runUrl = buildAppUrl(`/runs/${run.id}?view=details`).toString();
  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: title } },
    ...paragraphs.map((text) => ({
      type: "section",
      text: { type: "plain_text", text },
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
              buildAppUrl("/projects/repositories/sandboxes").toString(),
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
    text: [title, ...paragraphs, `View run details: ${runUrl}`].join("\n\n"),
    blocks,
  };
}
