import { expect, test } from "@playwright/test";
import { buildE2EAuthHeaders } from "./helpers/auth";
import { connectedUser, fulfillJson } from "./helpers/flows-pane-runs-fixtures";

test("running flow runs expose cancel in the recent runs rail", async ({
  page,
}) => {
  await page.context().setExtraHTTPHeaders({
    ...buildE2EAuthHeaders(connectedUser.id),
    "x-mogplex-scope-kind": "personal",
    "x-mogplex-scope-slug": connectedUser.username,
    "x-mogplex-scope-id": connectedUser.id,
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "dark");
  });

  let cancelCount = 0;
  let signalCancelStarted!: () => void;
  const cancelStarted = new Promise<void>((resolve) => {
    signalCancelStarted = resolve;
  });
  let releaseCancelResponse!: () => void;
  const cancelCanFinish = new Promise<void>((resolve) => {
    releaseCancelResponse = resolve;
  });

  const flowPayload = {
    id: "flow-1",
    installation_id: 101,
    name: "NEXTJS-REVIEWER · PR opened",
    description: "Migrated from Trigger",
    notes: null,
    source_kind: "github",
    status: "active",
    last_run_status: "running",
    published_version_id: "version-1",
    published_version: {
      id: "version-1",
      flow_id: "flow-1",
      version_number: 1,
      graph: {
        nodes: [
          {
            id: "start",
            type: "start",
            position: { x: 120, y: 160 },
            data: { label: "PR opened", event: "pr_opened" },
          },
          {
            id: "agent-1",
            type: "agent",
            position: { x: 380, y: 160 },
            data: {
              label: "NEXTJS-REVIEWER",
              agentId: "agent-1",
              role: "review",
            },
          },
          {
            id: "end",
            type: "end",
            position: { x: 660, y: 160 },
            data: { label: "Done" },
          },
        ],
        edges: [
          { id: "edge-1", source: "start", target: "agent-1" },
          { id: "edge-2", source: "agent-1", target: "end" },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      created_at: "2026-03-28T17:00:00.000Z",
    },
    draft_graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 120, y: 160 },
          data: { label: "PR opened", event: "pr_opened" },
        },
        {
          id: "agent-1",
          type: "agent",
          position: { x: 380, y: 160 },
          data: {
            label: "NEXTJS-REVIEWER",
            agentId: "agent-1",
            role: "review",
          },
        },
        {
          id: "end",
          type: "end",
          position: { x: 660, y: 160 },
          data: { label: "Done" },
        },
      ],
      edges: [
        { id: "edge-1", source: "start", target: "agent-1" },
        { id: "edge-2", source: "agent-1", target: "end" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };

  const runSummary = {
    id: "job-running",
    assignment_id: null,
    trigger_id: null,
    flow_id: "flow-1",
    flow_version_id: "version-1",
    runtime_provider: "trigger",
    runtime_run_id: "run_live_1",
    workflow_run_id: null,
    retry_of_job_run_id: null,
    status: "running",
    created_at: "2026-03-29T11:00:00.000Z",
    started_at: "2026-03-29T11:00:05.000Z",
    completed_at: null,
    input_tokens: null,
    output_tokens: null,
    duration_ms: null,
    error: null,
    start_attempts: 1,
    last_start_attempt_at: "2026-03-29T11:00:05.000Z",
    last_start_error: null,
    last_start_source: "webhook",
    cancel_requested_at: null,
    cancelled_at: null,
    cancel_reason: null,
    cancel_error: null,
    metadata: {
      repo_id: "repo-1",
      repo_full_name: "webrenew/blackbox",
      source_type: "pr_opened",
    },
    source_kind: "flow",
    source_type: "pr_opened",
    repo: {
      id: "repo-1",
      full_name: "webrenew/blackbox",
    },
    agent: {
      id: null,
      name: null,
      slug: null,
    },
    latest_ai_call: null,
    active_wait_count: 1,
    cancelable: true,
    repairable: false,
    requeueable: false,
    latest_dispatch_event: {
      outcome: "started",
      reason: null,
      created_at: "2026-03-29T11:00:06.000Z",
    },
    node_runs: [],
  };

  const cancelledRunSummary = {
    ...runSummary,
    status: "cancelled",
    completed_at: "2026-03-29T11:01:02.000Z",
    cancel_requested_at: "2026-03-29T11:01:00.000Z",
    cancelled_at: "2026-03-29T11:01:02.000Z",
    cancel_reason: "USER_REQUESTED",
    cancel_error: null,
    cancelable: false,
    latest_dispatch_event: {
      outcome: "cancelled",
      reason: "USER_REQUESTED",
      created_at: "2026-03-29T11:01:02.000Z",
    },
  };

  const failedRunSummary = {
    ...runSummary,
    id: "job-failed",
    runtime_run_id: "run_failed_1",
    status: "failed",
    completed_at: "2026-03-29T11:03:00.000Z",
    duration_ms: 175000,
    error: "Review findings need follow-up",
    cancel_requested_at: null,
    cancelled_at: null,
    cancel_reason: null,
    cancel_error: null,
    cancelable: false,
    repairable: true,
    requeueable: false,
    latest_dispatch_event: {
      outcome: "completed",
      reason: "REVIEW_REQUIRED",
      created_at: "2026-03-29T11:03:00.000Z",
    },
  };

  const cancelledRunDetail = {
    ...cancelledRunSummary,
    dispatch_events: [
      {
        id: "dispatch-1",
        event_kind: "enqueue",
        outcome: "queued",
        reason: null,
        metadata: { source: "webhook" },
        created_at: "2026-03-29T11:00:00.000Z",
      },
      {
        id: "dispatch-2",
        event_kind: "start",
        outcome: "started",
        reason: null,
        metadata: null,
        created_at: "2026-03-29T11:00:06.000Z",
      },
      {
        id: "dispatch-3",
        event_kind: "control",
        outcome: "cancel_requested",
        reason: "USER_REQUESTED",
        metadata: { cancel_requested_at: "2026-03-29T11:01:00.000Z" },
        created_at: "2026-03-29T11:01:00.000Z",
      },
      {
        id: "dispatch-4",
        event_kind: "control",
        outcome: "cancelled",
        reason: "USER_REQUESTED",
        metadata: { cancelled_at: "2026-03-29T11:01:02.000Z" },
        created_at: "2026-03-29T11:01:02.000Z",
      },
    ],
    ai_calls: [],
    review_findings: [],
  };

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: "minimax/minimax-m2.5", theme: "dark" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [
        {
          id: "minimax/minimax-m2.5",
          provider: "minimax",
          name: "MiniMax M2.5",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
        },
      ],
      catalog: [
        {
          id: "minimax/minimax-m2.5",
          provider: "minimax",
          name: "MiniMax M2.5",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
          is_enabled: true,
        },
      ],
    })
  );
  await page.route("**/api/agents", (route) =>
    fulfillJson(route, [
      {
        id: "agent-1",
        name: "NEXTJS-REVIEWER",
        slug: "nextjs-reviewer",
        model: "minimax/minimax-m2.5",
      },
    ])
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [
      {
        id: "inst-1",
        installation_id: 101,
        account_login: "webrenew",
        repositories: [{ id: "repo-1", full_name: "webrenew/blackbox" }],
      },
    ])
  );
  await page.route("**/api/flows", (route) =>
    fulfillJson(route, [flowPayload])
  );
  await page.route("**/api/flows/flow-1", (route) =>
    fulfillJson(route, flowPayload)
  );
  await page.route("**/api/flows/flow-1/runs?limit=12", (route) =>
    fulfillJson(route, {
      runs: [
        cancelCount > 0 ? cancelledRunSummary : runSummary,
        failedRunSummary,
      ],
    })
  );
  await page.route("**/api/flows/flow-1/runs/job-running", (route) =>
    fulfillJson(route, {
      run: cancelCount > 0 ? cancelledRunDetail : runSummary,
    })
  );
  await page.route(
    "**/api/observability/jobs/job-running/cancel",
    async (route) => {
      cancelCount += 1;
      signalCancelStarted();
      await cancelCanFinish;
      await fulfillJson(route, {
        ok: true,
        status: "cancelled",
        cancelRequestedAt: "2026-03-29T11:01:00.000Z",
        cancelledAt: "2026-03-29T11:01:02.000Z",
        cancelReason: "USER_REQUESTED",
        cancelError: null,
        runtimeProvider: "trigger",
        runtimeRunId: "run_live_1",
        aiCallsCancellationRequested: 0,
        releasedJobs: [],
      });
    }
  );

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("flow-execution-log")).toContainText("waiting");
  await page.getByRole("tab", { name: /^Runs/ }).click();
  await expect(
    page
      .getByTestId("flow-run-card-job-running")
      .getByText("waiting", { exact: true })
  ).toBeVisible();

  await page
    .getByTestId("flow-run-card-job-running")
    .getByRole("button", { name: "Cancel" })
    .click();
  await cancelStarted;
  await expect(
    page
      .getByTestId("flow-run-card-job-running")
      .getByRole("button", { name: "Cancel" })
  ).toBeDisabled();
  await expect(
    page
      .getByTestId("flow-run-card-job-failed")
      .getByRole("button", { name: "Repair" })
  ).toBeEnabled();
  releaseCancelResponse();
  expect(cancelCount).toBe(1);
  await expect(page.getByTestId("flow-run-card-job-running")).toContainText(
    "cancelled"
  );
  await expect(page.getByTestId("flow-run-card-job-running")).toContainText(
    "Cancelled"
  );

  await page.getByTestId("flow-run-card-job-running").click();
  const dialog = page.locator("[data-slot='dialog-content']");
  await expect(dialog.getByText("Cancellation", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Repair" })).toHaveCount(0);
  await expect(dialog.getByText("Cancel requested")).toBeVisible();
  await dialog.getByText("Technical details").click();
  await expect(dialog.getByText("Cancelled at")).toBeVisible();
});
