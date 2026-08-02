import { expect, test } from "@playwright/test";
import {
  buildE2EAuthHeaders,
  enableScopedE2EAuth,
  scopedPath,
} from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import type { Route } from "@playwright/test";

const connectedUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "alex@example.com",
  username: "alex",
  name: "Alex",
  avatar_url: "https://example.com/avatar.png",
  github_connected: true,
  github_app_connected: true,
  github_app_available: true,
  github_connection_mode: "app" as const,
  vercel: linkedVercelCapability,
};

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

test("recent runs open a detailed observability dialog", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({
    ...buildE2EAuthHeaders(connectedUser.id),
    "x-mogplex-scope-kind": "personal",
    "x-mogplex-scope-slug": connectedUser.username,
    "x-mogplex-scope-id": connectedUser.id,
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "dark");
    window.localStorage.setItem(
      "flow-assistant-panel",
      JSON.stringify({
        state: {
          open: true,
        },
        version: 0,
      })
    );
  });

  const flowPayload = {
    id: "flow-1",
    installation_id: 101,
    name: "NEXTJS-REVIEWER · PR opened",
    description: "Migrated from Trigger",
    notes: "Capture intent, guardrails, and context for this flow.",
    source_kind: "github",
    status: "active",
    last_run_status: "success",
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
            data: { label: "NEXTJS-REVIEWER", agentId: "agent-1" },
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
          data: { label: "NEXTJS-REVIEWER", agentId: "agent-1" },
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
    id: "job-1",
    assignment_id: null,
    trigger_id: null,
    flow_id: "flow-1",
    flow_version_id: "version-1",
    runtime_provider: "trigger",
    runtime_run_id: "run_123",
    workflow_run_id: null,
    retry_of_job_run_id: null,
    status: "failed",
    created_at: "2026-03-28T11:00:00.000Z",
    started_at: "2026-03-28T11:01:00.000Z",
    completed_at: "2026-03-28T11:02:00.000Z",
    input_tokens: 120,
    output_tokens: 80,
    duration_ms: 60000,
    error: "Lint failed on CI",
    start_attempts: 2,
    last_start_attempt_at: "2026-03-28T11:01:00.000Z",
    last_start_error: "Lint failed on CI",
    last_start_source: "webhook",
    cancel_requested_at: null,
    cancelled_at: null,
    cancel_reason: null,
    cancel_error: null,
    metadata: {
      repo_id: "repo-1",
      repo_full_name: "webrenew/blackbox",
      source_type: "pr_opened",
      pr_number: 42,
      pr_url: "https://github.com/webrenew/blackbox/pull/42",
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
    latest_ai_call: {
      id: "call-1",
      status: "success",
      model: "minimax/minimax-m2.5",
      total_tokens: 200,
      tool_calls_count: 1,
      started_at: "2026-03-28T11:01:05.000Z",
    },
    cancelable: false,
    repairable: true,
    requeueable: true,
    latest_dispatch_event: {
      outcome: "start_failed",
      reason: "LINT_FAILED",
      created_at: "2026-03-28T11:01:30.000Z",
    },
    node_runs: [
      {
        id: "node-run-1",
        user_id: "user-1",
        job_run_id: "job-1",
        flow_id: "flow-1",
        flow_version_id: "version-1",
        node_id: "agent-1",
        node_type: "agent",
        node_label: "NEXTJS-REVIEWER",
        status: "failed",
        started_at: "2026-03-28T11:01:00.000Z",
        completed_at: "2026-03-28T11:02:00.000Z",
        duration_ms: 60000,
        error: "Lint failed on CI",
        output: {
          role: "review",
          text: "Reported lint failures and suggested the exact fix path.",
        },
        created_at: "2026-03-28T11:01:00.000Z",
      },
    ],
  };

  const editPatch = [
    "diff --git a/src/widget.ts b/src/widget.ts",
    "index 1111111..2222222 100644",
    "--- a/src/widget.ts",
    "+++ b/src/widget.ts",
    "@@ -1 +1 @@",
    "-export const widget = 'old'",
    "+export const widget = 'new'",
  ].join("\n");

  const runDetail = {
    ...runSummary,
    node_runs: [
      ...runSummary.node_runs,
      {
        id: "node-run-2",
        user_id: "user-1",
        job_run_id: "job-1",
        flow_id: "flow-1",
        flow_version_id: "version-1",
        node_id: "agent-2",
        node_type: "agent",
        node_label: "PR-FIXER",
        status: "success",
        started_at: "2026-03-28T11:02:00.000Z",
        completed_at: "2026-03-28T11:02:30.000Z",
        duration_ms: 30000,
        error: null,
        output: {
          role: "edit",
          text: "Applied a focused widget fix.",
          tool_calls: [
            {
              name: "updateFile",
              input: { path: "src/widget.ts" },
              output: {
                success: true,
                path: "src/widget.ts",
                branch: "fix/widget",
                commitSha: "abcdef1234567890",
                commitUrl:
                  "https://github.com/webrenew/blackbox/commit/abcdef1234567890",
                patch: editPatch,
              },
            },
          ],
        },
        created_at: "2026-03-28T11:02:00.000Z",
      },
    ],
    dispatch_events: [
      {
        id: "dispatch-1",
        event_kind: "enqueue",
        outcome: "queued",
        reason: null,
        metadata: { source: "webhook" },
        created_at: "2026-03-28T11:00:30.000Z",
      },
      {
        id: "dispatch-2",
        event_kind: "start",
        outcome: "start_failed",
        reason: "LINT_FAILED",
        metadata: { retryable: true },
        created_at: "2026-03-28T11:01:30.000Z",
      },
    ],
    ai_calls: [
      {
        id: "call-1",
        user_id: "user-1",
        type: "agent",
        model: "minimax/minimax-m2.5",
        input_tokens: 120,
        output_tokens: 80,
        total_tokens: 200,
        duration_ms: 45000,
        started_at: "2026-03-28T11:01:05.000Z",
        completed_at: "2026-03-28T11:01:50.000Z",
        status: "success",
        error: null,
        conversation_id: null,
        job_run_id: "job-1",
        repo_id: "repo-1",
        limit_claim_id: null,
        cancel_requested_at: null,
        control_state: "active",
        runtime_command_id: "cmd_123",
        tool_calls_count: 1,
        tool_calls: [
          {
            name: "postComment",
            input_preview: "Review comment",
            output_preview: "comment created",
          },
        ],
        metadata: { agent_id: "agent-1" },
        events: [
          {
            id: "call-event-1",
            ai_call_id: "call-1",
            user_id: "user-1",
            conversation_id: null,
            repo_id: "repo-1",
            event_type: "started",
            tool_name: null,
            message: "Agent started",
            payload: {},
            created_at: "2026-03-28T11:01:05.000Z",
          },
          {
            id: "call-event-2",
            ai_call_id: "call-1",
            user_id: "user-1",
            conversation_id: null,
            repo_id: "repo-1",
            event_type: "finished",
            tool_name: null,
            message: "Agent finished",
            payload: { finishReason: "stop" },
            created_at: "2026-03-28T11:01:50.000Z",
          },
        ],
      },
    ],
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
    fulfillJson(route, { runs: [runSummary] })
  );
  await page.route("**/api/flows/flow-1/runs/job-1", (route) =>
    fulfillJson(route, { run: runDetail })
  );

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("flow-assistant-panel")).toBeVisible();
  await page.getByTestId("flows-runs-tab").click();
  await expect(page.getByTestId("flows-runs-tab")).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page).toHaveURL(/\/alex\/workflows\?tab=runs$/);
  await expect(page.getByText("Run history")).toBeVisible();

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/alex\/workflows\?tab=runs$/);
  await expect(page.getByTestId("flows-runs-tab")).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.getByText("Run history")).toBeVisible();

  const runCard = page.getByTestId("flow-run-card-job-1");
  await expect(runCard).toBeVisible();
  await expect(runCard).not.toContainText("run_123");
  await expect(runCard).not.toContainText("trigger · run_123");
  await expect(runCard.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(runCard.getByRole("button", { name: "Repair" })).toBeVisible();
  await expect(runCard.getByRole("button", { name: "Cancel" })).toHaveCount(0);

  await runCard.click();

  const dialog = page.locator("[data-slot='dialog-content']");
  await expect(dialog.getByText("Run details", { exact: true })).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox?.width ?? 0).toBeGreaterThan(1000);
  await expect(dialog.getByText("Dispatch timeline")).toBeVisible();
  await expect(
    dialog.getByText("Node execution", { exact: true })
  ).toBeVisible();
  await expect(dialog.getByText("AI calls", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Runtime provider")).toHaveCount(0);
  await expect(dialog.getByText("Runtime handle")).toHaveCount(0);
  await expect(dialog.getByText("run_123")).toHaveCount(0);
  await expect(
    dialog.getByText("PR OPENED", { exact: true }).first()
  ).toBeVisible();
  await expect(dialog.getByRole("link", { name: "PR #42" })).toHaveAttribute(
    "href",
    "https://github.com/webrenew/blackbox/pull/42"
  );
  await expect(dialog.getByText("Edits", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("src/widget.ts", { exact: true }).first()
  ).toBeVisible();
  await expect(dialog.getByRole("link", { name: "abcdef1" })).toHaveAttribute(
    "href",
    "https://github.com/webrenew/blackbox/commit/abcdef1234567890"
  );
  await expect(
    dialog
      .locator("[data-line-type='change-addition']")
      .filter({ hasText: "export const widget = 'new'" })
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Repair" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(
    dialog
      .getByText("Reported lint failures and suggested the exact fix path.")
      .first()
  ).toBeVisible();
  await expect(dialog).toContainText("Lint failed on CI");

  await dialog.getByText("Tool calls").click();
  await expect(dialog.getByText("postComment")).toBeVisible();

  await dialog.getByText("Call events").click();
  await expect(dialog.getByText("Agent finished")).toBeVisible();
});

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

test("completed runs hide follow-up actions and show the terminal empty state", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "dark");
  });

  const flowPayload = {
    id: "flow-1",
    installation_id: 101,
    name: "NEXTJS-REVIEWER · PR opened",
    description: "Migrated from Trigger",
    notes: null,
    source_kind: "github",
    status: "active",
    last_run_status: "success",
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
            data: { label: "NEXTJS-REVIEWER", agentId: "agent-1" },
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
          data: { label: "NEXTJS-REVIEWER", agentId: "agent-1" },
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
    id: "job-success",
    assignment_id: null,
    trigger_id: null,
    flow_id: "flow-1",
    flow_version_id: "version-1",
    runtime_provider: "trigger",
    runtime_run_id: "run_success_1",
    workflow_run_id: null,
    retry_of_job_run_id: null,
    status: "success",
    created_at: "2026-03-30T11:00:00.000Z",
    started_at: "2026-03-30T11:00:05.000Z",
    completed_at: "2026-03-30T11:01:05.000Z",
    input_tokens: 80,
    output_tokens: 40,
    duration_ms: 60000,
    error: null,
    start_attempts: 1,
    last_start_attempt_at: "2026-03-30T11:00:05.000Z",
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
      pr_number: 84,
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
    cancelable: false,
    repairable: false,
    requeueable: false,
    latest_dispatch_event: {
      outcome: "completed",
      reason: null,
      created_at: "2026-03-30T11:01:05.000Z",
    },
    node_runs: [],
  };

  const runDetail = {
    ...runSummary,
    dispatch_events: [
      {
        id: "dispatch-1",
        event_kind: "enqueue",
        outcome: "queued",
        reason: null,
        metadata: { source: "webhook" },
        created_at: "2026-03-30T11:00:00.000Z",
      },
      {
        id: "dispatch-2",
        event_kind: "start",
        outcome: "completed",
        reason: null,
        metadata: null,
        created_at: "2026-03-30T11:01:05.000Z",
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
    fulfillJson(route, { runs: [runSummary] })
  );
  await page.route("**/api/flows/flow-1/runs/job-success", (route) =>
    fulfillJson(route, { run: runDetail })
  );

  await page.goto(scopedPath("workflows"));
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: /^Runs/ }).click();

  await page.getByTestId("flow-run-card-job-success").click();

  const dialog = page.locator("[data-slot='dialog-content']");
  await expect(
    dialog.getByText("Completed runs do not have follow-up actions.")
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Repair" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "PR #84" })).toBeVisible();
});

test("a run that recovered through an error edge shows a failed node and a successful recovery node", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "dark");
  });

  const flowPayload = {
    id: "flow-recover",
    installation_id: 101,
    name: "RECOVERY-REVIEWER · PR opened",
    description: null,
    notes: null,
    source_kind: "github",
    status: "active",
    last_run_status: "success",
    published_version_id: "version-recover",
    published_version: {
      id: "version-recover",
      flow_id: "flow-recover",
      version_number: 1,
      graph: {
        nodes: [
          {
            id: "start",
            type: "start",
            position: { x: 80, y: 160 },
            data: { label: "PR opened", event: "pr_opened" },
          },
          {
            id: "agent-fail",
            type: "agent",
            position: { x: 320, y: 160 },
            data: { label: "FAILING-REVIEWER", agentId: "agent-fail" },
          },
          {
            id: "agent-recover",
            type: "agent",
            position: { x: 560, y: 320 },
            data: { label: "RECOVERY-RESPONDER", agentId: "agent-recover" },
          },
          {
            id: "end",
            type: "end",
            position: { x: 800, y: 160 },
            data: { label: "Done" },
          },
        ],
        edges: [
          { id: "edge-start-fail", source: "start", target: "agent-fail" },
          {
            id: "edge-fail-recover",
            source: "agent-fail",
            target: "agent-recover",
            sourceHandle: "error",
          },
          { id: "edge-recover-end", source: "agent-recover", target: "end" },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      created_at: "2026-04-01T17:00:00.000Z",
    },
    draft_graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 80, y: 160 },
          data: { label: "PR opened", event: "pr_opened" },
        },
        {
          id: "agent-fail",
          type: "agent",
          position: { x: 320, y: 160 },
          data: { label: "FAILING-REVIEWER", agentId: "agent-fail" },
        },
        {
          id: "agent-recover",
          type: "agent",
          position: { x: 560, y: 320 },
          data: { label: "RECOVERY-RESPONDER", agentId: "agent-recover" },
        },
        {
          id: "end",
          type: "end",
          position: { x: 800, y: 160 },
          data: { label: "Done" },
        },
      ],
      edges: [
        { id: "edge-start-fail", source: "start", target: "agent-fail" },
        {
          id: "edge-fail-recover",
          source: "agent-fail",
          target: "agent-recover",
          sourceHandle: "error",
        },
        { id: "edge-recover-end", source: "agent-recover", target: "end" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };

  const runSummary = {
    id: "job-recover",
    assignment_id: null,
    trigger_id: null,
    flow_id: "flow-recover",
    flow_version_id: "version-recover",
    runtime_provider: "trigger",
    runtime_run_id: "run_recover_1",
    workflow_run_id: null,
    retry_of_job_run_id: null,
    status: "success",
    created_at: "2026-04-01T11:00:00.000Z",
    started_at: "2026-04-01T11:00:05.000Z",
    completed_at: "2026-04-01T11:01:05.000Z",
    input_tokens: 80,
    output_tokens: 40,
    duration_ms: 60000,
    error: null,
    start_attempts: 1,
    last_start_attempt_at: "2026-04-01T11:00:05.000Z",
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
      pr_number: 91,
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
    cancelable: false,
    repairable: false,
    requeueable: false,
    latest_dispatch_event: {
      outcome: "completed",
      reason: null,
      created_at: "2026-04-01T11:01:05.000Z",
    },
    node_runs: [
      {
        id: "node-run-fail",
        user_id: "user-1",
        job_run_id: "job-recover",
        flow_id: "flow-recover",
        flow_version_id: "version-recover",
        node_id: "agent-fail",
        node_type: "agent",
        node_label: "FAILING-REVIEWER",
        status: "failed",
        started_at: "2026-04-01T11:00:10.000Z",
        completed_at: "2026-04-01T11:00:30.000Z",
        duration_ms: 20000,
        error: 'Missing agent for node "FAILING-REVIEWER"',
        output: null,
        created_at: "2026-04-01T11:00:10.000Z",
      },
      {
        id: "node-run-recover",
        user_id: "user-1",
        job_run_id: "job-recover",
        flow_id: "flow-recover",
        flow_version_id: "version-recover",
        node_id: "agent-recover",
        node_type: "agent",
        node_label: "RECOVERY-RESPONDER",
        status: "success",
        started_at: "2026-04-01T11:00:30.000Z",
        completed_at: "2026-04-01T11:01:00.000Z",
        duration_ms: 30000,
        error: null,
        output: { role: "triage", text: "Recovered from upstream failure." },
        created_at: "2026-04-01T11:00:30.000Z",
      },
    ],
  };

  const runDetail = {
    ...runSummary,
    dispatch_events: [
      {
        id: "dispatch-1",
        event_kind: "enqueue",
        outcome: "queued",
        reason: null,
        metadata: { source: "webhook" },
        created_at: "2026-04-01T11:00:00.000Z",
      },
      {
        id: "dispatch-2",
        event_kind: "start",
        outcome: "completed",
        reason: null,
        metadata: null,
        created_at: "2026-04-01T11:01:05.000Z",
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
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
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
  await page.route("**/api/flows/flow-recover", (route) =>
    fulfillJson(route, flowPayload)
  );
  await page.route("**/api/flows/flow-recover/runs?limit=12", (route) =>
    fulfillJson(route, { runs: [runSummary] })
  );
  await page.route("**/api/flows/flow-recover/runs/job-recover", (route) =>
    fulfillJson(route, { run: runDetail })
  );

  await page.goto(scopedPath("workflows"));
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: /^Runs/ }).click();

  const runCard = page.getByTestId("flow-run-card-job-recover");
  await expect(runCard).toBeVisible();
  // Failed node + recovered node both surface as badges; overall run is success.
  await expect(
    runCard.getByText(/FAILING-REVIEWER\s*·\s*failed/)
  ).toBeVisible();
  await expect(
    runCard.getByText(/RECOVERY-RESPONDER\s*·\s*success/)
  ).toBeVisible();
});
