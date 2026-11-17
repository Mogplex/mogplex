import { expect, test } from "vitest";
import { deliveryLifecycleFixture } from "@/tests/support/run-delivery-lifecycle-fixture";
import { resumeExternalAgentRun } from "@/lib/mogplex-api/run-resume";
import { handleCheckpointAction } from "@/lib/slack/run-checkpoint-interactions";
import { SLACK_CHECKPOINT_APPROVE_ACTION_ID } from "@/lib/slack/run-checkpoint-presentation";
import type {
  SlackInstallationRow,
  SlackUserMappingRow,
} from "@/lib/slack/installations";
import { refreshDeliveryForGithubEvent } from "./webhook";
import { readDeliverySnapshot } from "./types";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.example";
test("Slack plan approval preserves the workspace through implementation, PR, CI repair and merge evidence", async () => {
  const f = await deliveryLifecycleFixture();
  try {
    const approve = async (kind: "plan" | "review") => {
      const run = await f.current();
      return handleCheckpointAction(
        {
          type: "block_actions",
          team: { id: "T1" },
          user: { id: "U1" },
          actions: [
            {
              action_id: SLACK_CHECKPOINT_APPROVE_ACTION_ID,
              value: `${run.id}|${kind}|${run.ai_call_id}`,
            },
          ],
        },
        {
          getInstallation: async () =>
            ({ allowed_slack_user_ids: null }) as SlackInstallationRow,
          getUserMapping: async () =>
            ({
              mogplex_user_id: run.user_id,
              link_status: "explicit",
            }) as SlackUserMappingRow,
          loadRun: async (userId) => f.store.load(userId, run.id),
          queueResume: async (input) => {
            await f.queue(input);
          },
        }
      );
    };
    expect(await approve("plan")).toBe("resumed");
    expect(f.queued[0].followThrough).toBeUndefined();
    await resumeExternalAgentRun(
      { ...f.queued.shift()!, runtimeRunId: "implementation-worker" },
      f.deps
    );
    expect((await f.current()).status).toBe("awaiting_input");
    expect((await f.current()).metadata.checkpoint_kind).toBe("review");
    expect(await approve("review")).toBe("resumed");
    expect(f.queued[0].followThrough).toBe(true);
    await resumeExternalAgentRun(
      { ...f.queued.shift()!, runtimeRunId: "pr-worker" },
      f.deps
    );
    const opened = await f.current();
    expect(opened.metadata.delivery_follow_through).toBe(true);
    expect(readDeliverySnapshot(opened.metadata)?.pullRequest?.state).toBe(
      "open"
    );
    expect(f.queued).toHaveLength(0);
    f.snapshot.checks.state = "failure";
    f.snapshot.checks.failed = ["unit tests"];
    const event = {
      event: "check_run",
      body: { check_run: { head_sha: "head-1" } },
      repos: [
        {
          id: opened.repo_id,
          user_id: opened.user_id,
          full_name: opened.repo_full_name,
        },
      ],
    };
    const eventDeps = { list: f.store.listForRepos, refresh: f.refresh };
    await refreshDeliveryForGithubEvent(event, eventDeps);
    await refreshDeliveryForGithubEvent(event, eventDeps);
    expect(f.queued).toHaveLength(1);
    await resumeExternalAgentRun(
      { ...f.queued.shift()!, runtimeRunId: "repair-worker" },
      f.deps
    );
    expect((await f.current()).runtime_run_id).toBe("repair-worker");
    expect(
      readDeliverySnapshot((await f.current()).metadata)?.pullRequest?.headSha
    ).toBe("head-2");
    await refreshDeliveryForGithubEvent(event, eventDeps);
    expect(f.queued).toHaveLength(0);
    f.snapshot.checks.state = "success";
    f.snapshot.pullRequest!.state = "merged";
    f.snapshot.pullRequest!.mergeSha = "merge-1";
    await refreshDeliveryForGithubEvent(
      {
        ...event,
        event: "pull_request",
        body: {
          pull_request: {
            head: {
              sha: "head-2",
              ref: opened.working_branch,
              repo: { full_name: opened.repo_full_name },
            },
          },
        },
      },
      eventDeps
    );
    const merged = readDeliverySnapshot((await f.current()).metadata)!;
    expect(merged.pullRequest?.state).toBe("merged");
    expect(merged.deployment.state).toBe("not_reported");
    expect(f.launched).toHaveLength(3);
    expect(
      f.launched.every(
        (workspace) =>
          workspace.record === f.initial.sandbox_record_id &&
          workspace.branch === f.initial.working_branch &&
          !workspace.create
      )
    ).toBe(true);
    expect(f.prompts[2]).toContain(
      "Merge only if the user explicitly authorized"
    );
  } finally {
    await f.db.close();
  }
});
