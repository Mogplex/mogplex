import type { MogplexApiRepo } from "@/lib/mogplex-api/repos";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs";
import type { SlackBlock } from "@/lib/slack/client";
import {
  SLACK_COMMAND_SELECT_ACTION_ID,
  SLACK_CREATE_ISSUE_ACTION_ID,
  SLACK_ISSUE_BODY_ACTION_ID,
  SLACK_ISSUE_BODY_BLOCK_ID,
  SLACK_ISSUE_MODAL_CALLBACK_ID,
  SLACK_ISSUE_TITLE_ACTION_ID,
  SLACK_ISSUE_TITLE_BLOCK_ID,
  SLACK_MERGE_PR_ACTION_ID,
  SLACK_REFRESH_PRS_ACTION_ID,
  SLACK_REPO_SELECT_ACTION_ID,
  SLACK_VIEW_RUN_ACTION_ID,
} from "@/lib/slack/command-actions";
import type {
  SlackIssueList,
  SlackPullRequestList,
  SlackUsageSummary,
} from "@/lib/slack/command-data";
import {
  SLACK_CANCEL_RUN_ACTION_ID,
  SLACK_RUN_CONTROLS_BLOCK_ID,
} from "@/lib/slack/run-controls";

const COMMANDS = [
  ["status", "Status", "Active or recent run"],
  ["repo", "Repository", "Channel repository context"],
  ["prs", "Pull requests", "Open PR readiness"],
  ["issues", "Issues", "Browse or create issues"],
  ["usage", "Usage", "Plan and inference credit"],
  ["model", "Model", "Choose the channel model"],
] as const;

function plainText(text: string) {
  return { type: "plain_text", text: text.slice(0, 75), emoji: true };
}

function safeMrkdwn(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function buildSlackCommandHubBlocks(): SlackBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*What would you like to do?*\nChoose an action or type a subcommand after `/mogplex`.",
      },
    },
    {
      type: "actions",
      block_id: "mogplex_command_hub",
      elements: [
        {
          type: "static_select",
          action_id: SLACK_COMMAND_SELECT_ACTION_ID,
          placeholder: plainText("Choose a Mogplex command"),
          options: COMMANDS.map(([value, label, description]) => ({
            text: plainText(label),
            value,
            description: plainText(description),
          })),
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Try `/mogplex status`, `/mogplex repo`, or `/mogplex model`.",
        },
      ],
    },
  ];
}

export function buildSlackRepoBlocks(input: {
  currentRepoId: string | null;
  currentRepoName: string | null;
  repos: MogplexApiRepo[];
  canChange: boolean;
}): SlackBlock[] {
  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: input.currentRepoName
          ? `*Channel repository:* \`${safeMrkdwn(input.currentRepoName)}\``
          : "*Channel repository:* Not linked",
      },
    },
  ];
  if (!input.canChange) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "The Slack app installer can change this channel's repository.",
        },
      ],
    });
    return blocks;
  }
  if (input.repos.length === 0) return blocks;
  const visibleRepos = input.repos.slice(0, 100);
  const options = visibleRepos.map((repo) => ({
    text: plainText(repo.full_name),
    value: repo.id,
  }));
  const initialOption = options.find(
    (option) => option.value === input.currentRepoId
  );
  blocks.push({
    type: "actions",
    block_id: "mogplex_repo_picker",
    elements: [
      {
        type: "static_select",
        action_id: SLACK_REPO_SELECT_ACTION_ID,
        placeholder: plainText("Choose a repository"),
        options,
        ...(initialOption ? { initial_option: initialOption } : {}),
      },
    ],
  });
  return blocks;
}

function runRepo(run: ExternalAgentRunRow) {
  const value = run.metadata?.repo;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildSlackStatusBlocks(input: {
  run: ExternalAgentRunRow | null;
  runUrl?: string;
  progress?: string | null;
  model: string | null;
}): SlackBlock[] {
  if (!input.run) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Status:* No Slack-started runs yet.\n*Model:* \`${safeMrkdwn(input.model ?? "No usable model")}\``,
        },
      },
    ];
  }
  const repo = runRepo(input.run);
  const details = [
    `*Status:* ${safeMrkdwn(input.run.status)}`,
    repo ? `*Repository:* \`${safeMrkdwn(repo)}\`` : null,
    `*Branch:* \`${safeMrkdwn(input.run.working_branch)}\``,
    `*Model:* \`${safeMrkdwn(input.model ?? "No usable model")}\``,
    input.progress ? `*Latest:* ${safeMrkdwn(input.progress)}` : null,
    input.run.error ? "*Reason:* Mogplex could not complete this run." : null,
  ].filter(Boolean);
  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: details.join("\n") },
    },
  ];
  if (input.runUrl) {
    blocks.push({
      type: "actions",
      block_id: "mogplex_run_links",
      elements: [
        {
          type: "button",
          action_id: SLACK_VIEW_RUN_ACTION_ID,
          text: plainText("View run"),
          url: input.runUrl,
          value: input.run.id,
        },
      ],
    });
  }
  if (input.run.status === "pending" || input.run.status === "streaming") {
    blocks.push({
      type: "actions",
      block_id: SLACK_RUN_CONTROLS_BLOCK_ID,
      elements: [
        {
          type: "button",
          action_id: SLACK_CANCEL_RUN_ACTION_ID,
          text: plainText("Cancel run"),
          style: "danger",
          value: input.run.id,
          confirm: {
            title: plainText("Cancel this run?"),
            text: plainText("The current run will be stopped."),
            confirm: plainText("Cancel run"),
            deny: plainText("Keep running"),
          },
        },
      ],
    });
  }
  return blocks;
}

function prReadiness(pr: SlackPullRequestList["pullRequests"][number]) {
  if (pr.isDraft) return "draft";
  if (pr.mergeable === "conflicting") return "conflicts";
  if (pr.checkState === "failure" || pr.checkState === "error") {
    return "checks failing";
  }
  if (pr.unresolvedReviewThreads > 0) return "review findings";
  if (pr.checkState === "pending" || pr.checkState === "expected") {
    return "checks pending";
  }
  if (pr.reviewDecision === "changes_requested") return "changes requested";
  return "ready for review";
}

export function buildSlackPullRequestBlocks(input: {
  repo: MogplexApiRepo;
  list: SlackPullRequestList;
}): SlackBlock[] {
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: plainText(`Open PRs · ${input.repo.full_name}`),
    },
  ];
  if (input.list.pullRequests.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "No open pull requests." },
    });
    return blocks;
  }
  for (const pr of input.list.pullRequests) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `<${pr.url}|*#${pr.number} ${safeMrkdwn(pr.title)}*>\n${prReadiness(pr)} · CI ${pr.checkState ?? "not reported"} · ${pr.unresolvedReviewThreads} unresolved review thread${pr.unresolvedReviewThreads === 1 ? "" : "s"}`,
      },
      accessory: {
        type: "button",
        action_id: SLACK_MERGE_PR_ACTION_ID,
        text: plainText("Merge"),
        style: "primary",
        value: JSON.stringify({
          repoId: input.repo.id,
          number: pr.number,
          headSha: pr.headSha,
        }),
        confirm: {
          title: plainText(`Merge PR #${pr.number}?`),
          text: plainText(
            "Mogplex will re-check the head and repository gates."
          ),
          confirm: plainText("Merge when safe"),
          deny: plainText("Cancel"),
        },
      },
    });
  }
  blocks.push({
    type: "actions",
    block_id: "mogplex_pr_actions",
    elements: [
      {
        type: "button",
        action_id: SLACK_REFRESH_PRS_ACTION_ID,
        text: plainText("Refresh"),
        value: "prs",
      },
    ],
  });
  return blocks;
}

export function buildSlackIssueBlocks(input: {
  repo: MogplexApiRepo;
  list: SlackIssueList;
}): SlackBlock[] {
  const lines = input.list.issues.map(
    (issue) => `<${issue.url}|#${issue.number} ${safeMrkdwn(issue.title)}>`
  );
  return [
    {
      type: "header",
      text: plainText(`Open issues · ${input.repo.full_name}`),
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: lines.length > 0 ? lines.join("\n") : "No open issues.",
      },
    },
    {
      type: "actions",
      block_id: "mogplex_issue_actions",
      elements: [
        {
          type: "button",
          action_id: SLACK_CREATE_ISSUE_ACTION_ID,
          text: plainText("Create issue"),
          style: "primary",
          value: input.repo.id,
        },
      ],
    },
  ];
}

export function buildSlackUsageBlocks(
  summary: SlackUsageSummary
): SlackBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Plan:* ${safeMrkdwn(summary.plan)}`,
          `*Account status:* ${safeMrkdwn(summary.status)}`,
          `*Spendable inference credit:* ${money(summary.totalCents)}`,
          `Included ${money(summary.includedCents)} · Purchased ${money(summary.purchasedCents)}`,
        ].join("\n"),
      },
    },
  ];
}

export function buildSlackIssueModal(input: {
  repo: MogplexApiRepo;
  channelId: string;
}) {
  return {
    type: "modal",
    callback_id: SLACK_ISSUE_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({
      repoId: input.repo.id,
      channelId: input.channelId,
    }),
    title: plainText("Create GitHub issue"),
    submit: plainText("Create issue"),
    close: plainText("Cancel"),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Repository: \`${safeMrkdwn(input.repo.full_name)}\``,
        },
      },
      {
        type: "input",
        block_id: SLACK_ISSUE_TITLE_BLOCK_ID,
        label: plainText("Title"),
        element: {
          type: "plain_text_input",
          action_id: SLACK_ISSUE_TITLE_ACTION_ID,
          max_length: 256,
        },
      },
      {
        type: "input",
        block_id: SLACK_ISSUE_BODY_BLOCK_ID,
        optional: true,
        label: plainText("Description"),
        element: {
          type: "plain_text_input",
          action_id: SLACK_ISSUE_BODY_ACTION_ID,
          multiline: true,
          max_length: 3_000,
        },
      },
    ],
  };
}
