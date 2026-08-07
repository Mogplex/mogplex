import { expect, test } from "@playwright/test";
import { buildE2EAuthHeaders } from "./helpers/auth";
import { connectedUser, fulfillJson } from "./helpers/flows-pane-runs-fixtures";

test("recent runs open a detailed observability dialog", async ({ page }) => {
  // Width must be >= 1520 so the flows container (minus ~240px sidebar) exceeds
  // the 1280px dock-mode threshold.
  await page.setViewportSize({ width: 1600, height: 900 });
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
