import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { connectedUser, fulfillJson } from "./helpers/flows-pane-runs-fixtures";

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
