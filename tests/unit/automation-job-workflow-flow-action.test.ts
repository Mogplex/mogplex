import assert from "node:assert/strict";
import test from "node:test";
import { loadAutomationJobWorkflowModule } from "./helpers/automation-job-fixtures";

test("runFlowAction rejects command templates before resolving a sandbox checkout", async () => {
  const { runFlowAction } = await loadAutomationJobWorkflowModule();
  let pullRequestLookups = 0;
  let targetRepoLookups = 0;

  await assert.rejects(
    runFlowAction({
      jobRunId: "job-template-guard",
      nodeId: "action-template-guard",
      action: {
        label: "Unsafe command",
        operation: "sandbox.run_command",
        command: "git diff {{ metadata.head_ref }}",
        workingDirectory: null,
      },
      context: {
        metadata: { pr_number: 42 },
        assignmentType: "pr_review",
        skillId: null,
        agent: {
          model: "openai/gpt-5.4",
          system_prompt: null,
        },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
      githubToken: "github-token",
      loadPullRequestDetails: async () => {
        pullRequestLookups += 1;
        throw new Error("sandbox checkout resolution should not run");
      },
      resolveAutofixTargetRepo: async () => {
        targetRepoLookups += 1;
        throw new Error("sandbox target resolution should not run");
      },
    }),
    /Run command cannot use templates in shell commands/
  );
  assert.equal(pullRequestLookups, 0);
  assert.equal(targetRepoLookups, 0);
});

test("runFlowAction executes repository-scoped GitHub action operations", async () => {
  const { runFlowAction } = await loadAutomationJobWorkflowModule();
  const requests: Array<{
    path: string;
    method: string;
    body: Record<string, unknown> | null;
  }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    );
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    requests.push({ path: url.pathname, method, body });

    if (url.pathname.endsWith("/comments")) {
      return Response.json({ id: 11, html_url: "https://github.test/comment" });
    }
    if (url.pathname.endsWith("/issues")) {
      return Response.json({ number: 55, html_url: "https://github.test/55" });
    }
    if (url.pathname.endsWith("/labels") && method === "POST") {
      return Response.json([{ name: "ready" }, { name: "needs-review" }]);
    }
    if (url.pathname.includes("/labels/") && method === "DELETE") {
      return Response.json(
        { message: "Label does not exist on this issue" },
        { status: 404 }
      );
    }
    if (url.pathname.includes("/statuses/")) {
      return Response.json({
        id: 22,
        state: "success",
        context: "mogplex/release",
        sha: "a".repeat(40),
      });
    }
    if (url.pathname.endsWith("/reviews")) {
      return Response.json({ id: 33, html_url: "https://github.test/review" });
    }
    throw new Error(`Unexpected GitHub request: ${method} ${url.pathname}`);
  };
  const context = {
    metadata: {
      pr_number: 42,
      issue_number: 42,
      head_sha: "a".repeat(40),
    },
    assignmentType: "pr_review" as const,
    skillId: null,
    agent: {
      model: "openai/gpt-5.4",
      system_prompt: null,
    },
    repo: {
      id: "repo-123",
      user_id: "user-123",
      full_name: "acme/widgets",
      default_branch: "main",
      github_installation_id: 123,
    },
  };
  const baseInput = {
    jobRunId: "job-github-actions",
    context,
    githubToken: "github-token",
    loadPullRequestDetails: async () => null,
    resolveAutofixTargetRepo: async () => null,
    fetchImpl,
  };

  const comment = await runFlowAction({
    ...baseInput,
    nodeId: "comment",
    action: {
      label: "Comment",
      operation: "github.post_comment",
      targetNumber: null,
      body: "Done",
    },
  });
  const issue = await runFlowAction({
    ...baseInput,
    nodeId: "issue",
    action: {
      label: "Issue",
      operation: "github.create_issue",
      title: "Follow up",
      body: "Investigate",
      labels: ["automation"],
    },
  });
  const labels = await runFlowAction({
    ...baseInput,
    nodeId: "labels",
    action: {
      label: "Labels",
      operation: "github.update_labels",
      targetNumber: null,
      addLabels: ["ready"],
      removeLabels: ["needs-review", "already-absent"],
    },
  });
  const status = await runFlowAction({
    ...baseInput,
    nodeId: "status",
    action: {
      label: "Status",
      operation: "github.set_status",
      commitSha: null,
      state: "success",
      context: "mogplex/release",
      description: "Ready",
      targetUrl: "https://mogplex.dev/runs/1",
    },
  });
  const review = await runFlowAction({
    ...baseInput,
    nodeId: "review",
    action: {
      label: "Review",
      operation: "github.submit_review",
      pullRequestNumber: null,
      event: "APPROVE",
      body: "Looks good",
    },
  });
  await runFlowAction({
    ...baseInput,
    nodeId: "explicit-review",
    action: {
      label: "Review another PR",
      operation: "github.submit_review",
      pullRequestNumber: "99",
      event: "COMMENT",
      body: "Needs a look",
    },
  });
  await runFlowAction({
    ...baseInput,
    nodeId: "explicit-same-review",
    action: {
      label: "Review the triggering PR",
      operation: "github.submit_review",
      pullRequestNumber: "42",
      event: "COMMENT",
      body: "Still pinned",
    },
  });
  const merge = await runFlowAction({
    ...baseInput,
    nodeId: "merge",
    action: {
      label: "Merge",
      operation: "github.merge_pull_request",
      pullRequestNumber: null,
      commitTitle: "Workflow merge",
    },
  });

  assert.match(comment.summary, /#42/);
  assert.equal(comment.output.comment_id, 11);
  assert.match(issue.summary, /#55/);
  assert.deepEqual(labels.output.removed_labels, [
    "needs-review",
    "already-absent",
  ]);
  assert.deepEqual(labels.output.labels, ["ready"]);
  assert.equal(status.output.commit_sha, "a".repeat(40));
  assert.equal(review.output.review_id, 33);
  assert.match(merge.summary, /Requested safe merge.*#42/);
  assert.deepEqual(merge.output, {
    pull_request_number: 42,
    auto_merge_requested: true,
    commit_title: "Workflow merge",
  });
  assert.deepEqual(
    requests.map(({ path, method }) => ({ path, method })),
    [
      {
        path: "/repos/acme/widgets/issues/42/comments",
        method: "POST",
      },
      { path: "/repos/acme/widgets/issues", method: "POST" },
      { path: "/repos/acme/widgets/issues/42/labels", method: "POST" },
      {
        path: "/repos/acme/widgets/issues/42/labels/needs-review",
        method: "DELETE",
      },
      {
        path: `/repos/acme/widgets/statuses/${"a".repeat(40)}`,
        method: "POST",
      },
      { path: "/repos/acme/widgets/pulls/42/reviews", method: "POST" },
      { path: "/repos/acme/widgets/pulls/99/reviews", method: "POST" },
      { path: "/repos/acme/widgets/pulls/42/reviews", method: "POST" },
    ]
  );
  const reviewRequests = requests.filter(({ path }) =>
    path.endsWith("/reviews")
  );
  assert.equal(reviewRequests[0]?.body?.commit_id, "a".repeat(40));
  assert.equal("commit_id" in (reviewRequests[1]?.body ?? {}), false);
  assert.equal(reviewRequests[2]?.body?.commit_id, "a".repeat(40));
});

test("runFlowAction rejects an unresolved safe merge target before queuing", async () => {
  const { runFlowAction } = await loadAutomationJobWorkflowModule();

  await assert.rejects(
    runFlowAction({
      jobRunId: "job-merge-blocked",
      nodeId: "merge",
      action: {
        label: "Merge",
        operation: "github.merge_pull_request",
        pullRequestNumber: null,
        commitTitle: null,
      },
      context: {
        metadata: {},
        assignmentType: "webhook",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
      githubToken: "github-token",
      loadPullRequestDetails: async () => null,
      resolveAutofixTargetRepo: async () => null,
    }),
    /could not resolve the triggering pull request number/
  );
});

test("runFlowAction does not hide a missing GitHub label target", async () => {
  const { runFlowAction } = await loadAutomationJobWorkflowModule();
  let fetchCalls = 0;

  await assert.rejects(
    runFlowAction({
      jobRunId: "job-missing-label-target",
      nodeId: "labels",
      action: {
        label: "Remove label",
        operation: "github.update_labels",
        targetNumber: "404",
        addLabels: [],
        removeLabels: ["needs-review"],
      },
      context: {
        metadata: {},
        assignmentType: "webhook",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
      githubToken: "github-token",
      loadPullRequestDetails: async () => null,
      resolveAutofixTargetRepo: async () => null,
      fetchImpl: async () => {
        fetchCalls += 1;
        return Response.json({ message: "Not Found" }, { status: 404 });
      },
    }),
    /GitHub issue labels read failed \(404\): Not Found/
  );
  assert.equal(fetchCalls, 1);
});

test("runFlowAction rejects unresolved GitHub targets before mutation", async () => {
  const { runFlowAction } = await loadAutomationJobWorkflowModule();
  let fetchCalls = 0;

  await assert.rejects(
    runFlowAction({
      jobRunId: "job-missing-target",
      nodeId: "comment",
      action: {
        label: "Comment",
        operation: "github.post_comment",
        targetNumber: null,
        body: "Done",
      },
      context: {
        metadata: {},
        assignmentType: "webhook",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
      githubToken: "github-token",
      loadPullRequestDetails: async () => null,
      resolveAutofixTargetRepo: async () => null,
      fetchImpl: async () => {
        fetchCalls += 1;
        return Response.json({});
      },
    }),
    /could not resolve the triggering issue or pull request number/
  );
  assert.equal(fetchCalls, 0);
});

test("runFlowAction rejects empty resolved GitHub effects before mutation", async () => {
  const { runFlowAction } = await loadAutomationJobWorkflowModule();
  let fetchCalls = 0;

  await assert.rejects(
    runFlowAction({
      jobRunId: "job-empty-labels",
      nodeId: "labels",
      action: {
        label: "Labels",
        operation: "github.update_labels",
        targetNumber: "42",
        addLabels: [],
        removeLabels: [],
      },
      context: {
        metadata: {},
        assignmentType: "webhook",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
      githubToken: "github-token",
      loadPullRequestDetails: async () => null,
      resolveAutofixTargetRepo: async () => null,
      fetchImpl: async () => {
        fetchCalls += 1;
        return Response.json({});
      },
    }),
    /GitHub labels resolved to an empty value/
  );
  assert.equal(fetchCalls, 0);
});
