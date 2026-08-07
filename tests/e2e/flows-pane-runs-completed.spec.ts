import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { connectedUser, fulfillJson } from "./helpers/flows-pane-runs-fixtures";

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
