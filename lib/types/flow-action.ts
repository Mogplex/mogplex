/**
 * Flow action node types.
 */

export type FlowGithubCommitStatusState =
  | "pending"
  | "success"
  | "failure"
  | "error";

export type FlowGithubReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export type FlowActionOperation =
  | "sandbox.run_command"
  | "slack.send_message"
  | "github.post_comment"
  | "github.create_issue"
  | "github.update_labels"
  | "github.set_status"
  | "github.submit_review"
  | "github.merge_pull_request";

export type FlowActionNodeData =
  | {
      label: string;
      operation: "sandbox.run_command";
      command: string;
      workingDirectory: string | null;
    }
  | {
      label: string;
      operation: "slack.send_message";
      destination?: "channel" | "trigger_thread";
      teamId: string;
      channelId: string;
      channelName: string | null;
      message: string;
      unfurlLinks?: boolean;
    }
  | {
      label: string;
      operation: "github.post_comment";
      targetNumber: string | null;
      body: string;
    }
  | {
      label: string;
      operation: "github.create_issue";
      title: string;
      body: string;
      labels: string[];
    }
  | {
      label: string;
      operation: "github.update_labels";
      targetNumber: string | null;
      addLabels: string[];
      removeLabels: string[];
    }
  | {
      label: string;
      operation: "github.set_status";
      commitSha: string | null;
      state: FlowGithubCommitStatusState;
      context: string;
      description: string | null;
      targetUrl: string | null;
    }
  | {
      label: string;
      operation: "github.submit_review";
      pullRequestNumber: string | null;
      event: FlowGithubReviewEvent;
      body: string;
    }
  | {
      label: string;
      operation: "github.merge_pull_request";
      pullRequestNumber: string | null;
      commitTitle: string | null;
    };
