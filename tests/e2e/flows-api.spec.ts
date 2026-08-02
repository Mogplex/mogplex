import { expect, test } from "@playwright/test";
import { buildE2EAuthHeaders } from "./helpers/auth";
import type { APIRequestContext } from "@playwright/test";

const user1Headers = buildE2EAuthHeaders("user-1");
const user2Headers = buildE2EAuthHeaders("user-2");

type TestStateSeed = {
  installations?: Array<Record<string, unknown>>;
  agents?: Array<Record<string, unknown>>;
  flows?: Array<Record<string, unknown>>;
  flowVersions?: Array<Record<string, unknown>>;
  flowTemplates?: Array<Record<string, unknown>>;
  triggers?: Array<Record<string, unknown>>;
  jobRuns?: Array<Record<string, unknown>>;
  flowNodeRuns?: Array<Record<string, unknown>>;
  dispatchEvents?: Array<Record<string, unknown>>;
  aiCalls?: Array<Record<string, unknown>>;
  aiCallEvents?: Array<Record<string, unknown>>;
  assistant?: Record<string, unknown>;
  faults?: Record<string, unknown>;
};

async function seedState(request: APIRequestContext, state: TestStateSeed) {
  const response = await request.post("/api/test/e2e/flows", {
    headers: user1Headers,
    data: { state },
  });
  expect(response.ok()).toBeTruthy();
}

async function resetState(request: APIRequestContext) {
  const response = await request.delete("/api/test/e2e/flows", {
    headers: user1Headers,
  });
  expect(response.ok()).toBeTruthy();
}

async function getTestState(request: APIRequestContext) {
  const response = await request.get("/api/test/e2e/flows", {
    headers: user1Headers,
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

test("GET /api/flows returns owned flows with published versions and summaries", async ({
  request,
}) => {
  await seedState(request, {
    installations: [
      {
        id: "inst-1",
        user_id: "user-1",
        installation_id: 101,
        account_login: "acme",
      },
      {
        id: "inst-2",
        user_id: "user-2",
        installation_id: 202,
        account_login: "other",
      },
    ],
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Review Flow",
        description: "Primary flow",
        notes: "hello",
        source_kind: "github",
        status: "active",
        draft_graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "PR opened", event: "pr_opened" },
            },
            {
              id: "agent-1",
              type: "agent",
              position: { x: 100, y: 0 },
              data: { label: "Reviewer", agentId: "agent-1" },
            },
            {
              id: "end",
              type: "end",
              position: { x: 200, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start", target: "agent-1" },
            { id: "e2", source: "agent-1", target: "end" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: "version-1",
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:05:00.000Z",
      },
      {
        id: "flow-2",
        user_id: "user-2",
        installation_id: 202,
        name: "Hidden Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "inactive",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: null,
        created_at: "2026-03-28T09:00:00.000Z",
        updated_at: "2026-03-28T09:00:00.000Z",
      },
    ],
    flowVersions: [
      {
        id: "version-1",
        flow_id: "flow-1",
        version_number: 2,
        graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "PR opened", event: "pr_opened" },
            },
            {
              id: "agent-1",
              type: "agent",
              position: { x: 100, y: 0 },
              data: { label: "Reviewer", agentId: "agent-1" },
            },
            {
              id: "end",
              type: "end",
              position: { x: 200, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start", target: "agent-1" },
            { id: "e2", source: "agent-1", target: "end" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        created_at: "2026-03-28T10:01:00.000Z",
      },
    ],
    jobRuns: [
      {
        id: "job-1",
        flow_id: "flow-1",
        status: "failed",
        error: "lint failed",
        started_at: "2026-03-28T11:00:00.000Z",
        created_at: "2026-03-28T10:59:00.000Z",
        last_start_attempt_at: "2026-03-28T10:59:00.000Z",
      },
    ],
    dispatchEvents: [
      {
        id: "event-1",
        job_run_id: null,
        trigger_id: null,
        flow_id: "flow-1",
        outcome: "deferred",
        reason: "REPO_CONCURRENCY_LIMIT",
        created_at: "2026-03-28T11:10:00.000Z",
      },
    ],
  });

  const response = await request.get("/api/flows", { headers: user1Headers });
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  expect(payload).toHaveLength(1);
  expect(payload[0].id).toBe("flow-1");
  expect(payload[0].published_version.version_number).toBe(2);
  expect(payload[0].last_run_status).toBe("failed");
  expect(payload[0].last_pressure_reason).toBe("REPO_CONCURRENCY_LIMIT");
});

test("GET /api/flows repairs active unpublished flows by relinking the latest published version", async ({
  request,
}) => {
  await seedState(request, {
    installations: [
      {
        id: "inst-1",
        user_id: "user-1",
        installation_id: 101,
        account_login: "acme",
      },
    ],
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Repair Me",
        description: null,
        notes: null,
        source_kind: "github",
        status: "active",
        draft_graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "PR opened", event: "pr_opened" },
            },
            {
              id: "agent-1",
              type: "agent",
              position: { x: 100, y: 0 },
              data: { label: "Reviewer", agentId: "agent-1" },
            },
            {
              id: "end",
              type: "end",
              position: { x: 200, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start", target: "agent-1" },
            { id: "e2", source: "agent-1", target: "end" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: null,
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:05:00.000Z",
      },
    ],
    flowVersions: [
      {
        id: "version-1",
        flow_id: "flow-1",
        version_number: 1,
        graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "PR opened", event: "pr_opened" },
            },
            {
              id: "agent-1",
              type: "agent",
              position: { x: 100, y: 0 },
              data: { label: "Reviewer", agentId: "agent-1" },
            },
            {
              id: "end",
              type: "end",
              position: { x: 200, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start", target: "agent-1" },
            { id: "e2", source: "agent-1", target: "end" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        created_at: "2026-03-28T10:01:00.000Z",
      },
    ],
  });

  const response = await request.get("/api/flows", { headers: user1Headers });
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  expect(payload[0].published_version_id).toBe("version-1");
  expect(payload[0].status).toBe("active");

  const state = await getTestState(request);
  expect(state.flows[0].published_version_id).toBe("version-1");
});

test("GET /api/flows/:id/runs returns flow-scoped runs, dispatch context, and node runs", async ({
  request,
}) => {
  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Review Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "active",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: "version-1",
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    flowVersions: [
      {
        id: "version-1",
        flow_id: "flow-1",
        version_number: 1,
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        created_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    jobRuns: [
      {
        id: "job-1",
        flow_id: "flow-1",
        flow_version_id: "version-1",
        status: "failed",
        error: "lint failed",
        created_at: "2026-03-28T11:00:00.000Z",
        started_at: "2026-03-28T11:01:00.000Z",
        completed_at: "2026-03-28T11:02:00.000Z",
        duration_ms: 60000,
        start_attempts: 2,
        last_start_attempt_at: "2026-03-28T11:01:00.000Z",
        last_start_error: "lint failed",
        last_start_source: "webhook",
        runtime_provider: "trigger",
        runtime_run_id: "run_123",
        metadata: {
          repo_id: "repo-1",
          repo_full_name: "webrenew/blackbox",
          source_type: "pr_opened",
        },
      },
    ],
    flowNodeRuns: [
      {
        id: "node-run-1",
        user_id: "user-1",
        job_run_id: "job-1",
        flow_id: "flow-1",
        flow_version_id: "version-1",
        node_id: "agent-1",
        node_type: "agent",
        node_label: "Reviewer",
        status: "failed",
        started_at: "2026-03-28T11:01:00.000Z",
        completed_at: "2026-03-28T11:02:00.000Z",
        duration_ms: 60000,
        error: "lint failed",
        output: null,
        created_at: "2026-03-28T11:01:00.000Z",
      },
    ],
    dispatchEvents: [
      {
        id: "dispatch-1",
        job_run_id: "job-1",
        trigger_id: null,
        outcome: "start_failed",
        reason: "RUNTIME_HANDLE_PERSIST_FAILED",
        created_at: "2026-03-28T11:01:30.000Z",
      },
    ],
  });

  const response = await request.get("/api/flows/flow-1/runs?limit=5", {
    headers: user1Headers,
  });
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  expect(payload.runs).toHaveLength(1);
  expect(payload.runs[0].id).toBe("job-1");
  expect(payload.runs[0].source_kind).toBe("flow");
  expect(payload.runs[0].latest_dispatch_event.reason).toBe(
    "RUNTIME_HANDLE_PERSIST_FAILED"
  );
  expect(payload.runs[0].node_runs).toHaveLength(1);
  expect(payload.runs[0].node_runs[0].node_label).toBe("Reviewer");
});

test("GET /api/flows/:id/runs/:runId returns observability detail for a flow run", async ({
  request,
}) => {
  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Review Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "active",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: "version-1",
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    flowVersions: [
      {
        id: "version-1",
        flow_id: "flow-1",
        version_number: 1,
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        created_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    jobRuns: [
      {
        id: "job-1",
        flow_id: "flow-1",
        flow_version_id: "version-1",
        status: "success",
        error: null,
        created_at: "2026-03-28T11:00:00.000Z",
        started_at: "2026-03-28T11:01:00.000Z",
        completed_at: "2026-03-28T11:02:00.000Z",
        duration_ms: 60000,
        input_tokens: 120,
        output_tokens: 80,
        start_attempts: 1,
        last_start_attempt_at: "2026-03-28T11:01:00.000Z",
        last_start_error: null,
        last_start_source: "webhook",
        runtime_provider: "trigger",
        runtime_run_id: "run_123",
        metadata: {
          repo_id: "repo-1",
          repo_full_name: "webrenew/blackbox",
          source_type: "pr_opened",
        },
      },
    ],
    flowNodeRuns: [
      {
        id: "node-run-1",
        user_id: "user-1",
        job_run_id: "job-1",
        flow_id: "flow-1",
        flow_version_id: "version-1",
        node_id: "agent-1",
        node_type: "agent",
        node_label: "Reviewer",
        status: "success",
        started_at: "2026-03-28T11:01:00.000Z",
        completed_at: "2026-03-28T11:02:00.000Z",
        duration_ms: 60000,
        error: null,
        output: { summary: "LGTM" },
        created_at: "2026-03-28T11:01:00.000Z",
      },
    ],
    dispatchEvents: [
      {
        id: "dispatch-1",
        job_run_id: "job-1",
        trigger_id: null,
        flow_id: "flow-1",
        flow_version_id: "version-1",
        event_kind: "enqueue",
        outcome: "queued",
        reason: null,
        metadata: { source: "webhook" },
        created_at: "2026-03-28T11:00:30.000Z",
      },
      {
        id: "dispatch-2",
        job_run_id: "job-1",
        trigger_id: null,
        flow_id: "flow-1",
        flow_version_id: "version-1",
        event_kind: "start",
        outcome: "started",
        reason: null,
        metadata: { runtime_run_id: "run_123" },
        created_at: "2026-03-28T11:01:00.000Z",
      },
    ],
    aiCalls: [
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
            input_preview: "Looks good",
            output_preview: "commented",
          },
        ],
        metadata: { agent_id: "agent-1" },
      },
    ],
    aiCallEvents: [
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
  });

  const response = await request.get("/api/flows/flow-1/runs/job-1", {
    headers: user1Headers,
  });
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  expect(payload.run.id).toBe("job-1");
  expect(payload.run.dispatch_events).toHaveLength(2);
  expect(payload.run.dispatch_events[1].event_kind).toBe("start");
  expect(payload.run.ai_calls).toHaveLength(1);
  expect(payload.run.ai_calls[0].tool_calls).toHaveLength(1);
  expect(payload.run.ai_calls[0].events).toHaveLength(2);
  expect(payload.run.node_runs[0].output.summary).toBe("LGTM");
});

test("flow run endpoints keep historical source_type after a flow is republished", async ({
  request,
}) => {
  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Review Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "active",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: "version-2",
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    flowVersions: [
      {
        id: "version-1",
        flow_id: "flow-1",
        version_number: 1,
        graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "PR opened", event: "pr_opened" },
            },
            {
              id: "agent-1",
              type: "agent",
              position: { x: 100, y: 0 },
              data: { label: "Reviewer", agentId: "agent-1" },
            },
            {
              id: "end",
              type: "end",
              position: { x: 200, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start", target: "agent-1" },
            { id: "e2", source: "agent-1", target: "end" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        created_at: "2026-03-28T10:00:00.000Z",
      },
      {
        id: "version-2",
        flow_id: "flow-1",
        version_number: 2,
        graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Issue opened", event: "issue_opened" },
            },
            {
              id: "agent-2",
              type: "agent",
              position: { x: 100, y: 0 },
              data: { label: "Triage", agentId: "agent-2" },
            },
            {
              id: "end",
              type: "end",
              position: { x: 200, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start", target: "agent-2" },
            { id: "e2", source: "agent-2", target: "end" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        created_at: "2026-03-28T10:05:00.000Z",
      },
    ],
    jobRuns: [
      {
        id: "job-1",
        flow_id: "flow-1",
        flow_version_id: "version-1",
        status: "success",
        error: null,
        created_at: "2026-03-28T11:00:00.000Z",
        started_at: "2026-03-28T11:01:00.000Z",
        completed_at: "2026-03-28T11:02:00.000Z",
        duration_ms: 60000,
        start_attempts: 1,
        last_start_attempt_at: "2026-03-28T11:01:00.000Z",
        last_start_error: null,
        last_start_source: "webhook",
        runtime_provider: "trigger",
        runtime_run_id: "run_123",
        metadata: {
          repo_id: "repo-1",
          repo_full_name: "webrenew/blackbox",
        },
      },
    ],
  });

  const runsResponse = await request.get("/api/flows/flow-1/runs?limit=5", {
    headers: user1Headers,
  });
  expect(runsResponse.ok()).toBeTruthy();
  const runsPayload = await runsResponse.json();
  expect(runsPayload.runs[0].source_kind).toBe("flow");
  expect(runsPayload.runs[0].source_type).toBe("pr_opened");

  const detailResponse = await request.get("/api/flows/flow-1/runs/job-1", {
    headers: user1Headers,
  });
  expect(detailResponse.ok()).toBeTruthy();
  const detailPayload = await detailResponse.json();
  expect(detailPayload.run.source_kind).toBe("flow");
  expect(detailPayload.run.source_type).toBe("pr_opened");
});

test("POST /api/flows creates an inactive default flow for an owned installation", async ({
  request,
}) => {
  await seedState(request, {
    installations: [
      {
        id: "inst-1",
        user_id: "user-1",
        installation_id: 101,
        account_login: "acme",
      },
    ],
    agents: [
      {
        id: "agent-a",
        user_id: "user-1",
        name: "First Agent",
        slug: "first-agent",
        model: "minimax/minimax-m2.5",
        system_prompt: null,
      },
      {
        id: "agent-b",
        user_id: "user-1",
        name: "Second Agent",
        slug: "second-agent",
        model: "minimax/minimax-m2.5",
        system_prompt: null,
      },
    ],
  });

  const response = await request.post("/api/flows", {
    headers: user1Headers,
    data: {
      installation_id: 101,
      name: "New Flow",
    },
  });
  expect(response.status()).toBe(201);

  const payload = await response.json();
  expect(payload.name).toBe("New Flow");
  expect(payload.status).toBe("inactive");
  expect(
    payload.draft_graph.nodes.find(
      (node: { type: string }) => node.type === "agent"
    ).data.agentId
  ).toBe("agent-a");
});

test("POST /api/flows creates a validated workflow starter template", async ({
  request,
}) => {
  await seedState(request, {
    installations: [
      {
        id: "inst-1",
        user_id: "user-1",
        installation_id: 101,
        account_login: "acme",
      },
    ],
    agents: [
      {
        id: "agent-a",
        user_id: "user-1",
        name: "Primary Agent",
        slug: "primary-agent",
        model: "minimax/minimax-m2.5",
        system_prompt: null,
      },
    ],
  });

  const invalidResponse = await request.post("/api/flows", {
    headers: user1Headers,
    data: {
      installation_id: 101,
      template_id: "not-a-template",
    },
  });
  expect(invalidResponse.status()).toBe(400);

  const response = await request.post("/api/flows", {
    headers: user1Headers,
    data: {
      installation_id: 101,
      template_id: "dependabot-autopilot",
    },
  });
  expect(response.status()).toBe(201);

  const payload = await response.json();
  const startNode = payload.draft_graph.nodes.find(
    (node: { type: string }) => node.type === "start"
  );
  const agentNode = payload.draft_graph.nodes.find(
    (node: { type: string }) => node.type === "agent"
  );
  expect(payload.name).toBe("Dependabot autopilot");
  expect(payload.description).toBe(
    "Review, repair, and merge safe Dependabot updates."
  );
  expect(startNode.data.event).toBe("pr_opened");
  expect(startNode.data.filter.authorFilter).toBe("dependabot_only");
  expect(agentNode.data.agentId).toBe("agent-a");
  expect(agentNode.data.autofixSandbox).toBe(true);
  expect(agentNode.data.autoMerge).toBe(true);
});

test("personal workflow templates are private, sanitized, and rebound on creation", async ({
  request,
}) => {
  const sourceGraph = {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 80, y: 140 },
        data: {
          label: "PR opened",
          event: "pr_opened",
          filter: {
            scope: "all",
            installationIds: [101],
            repos: ["acme/source"],
          },
        },
      },
      {
        id: "agent",
        type: "agent",
        position: { x: 360, y: 140 },
        data: {
          label: "Primary Agent",
          agentId: "agent-a",
          role: "review",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 640, y: 140 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "start-agent", source: "start", target: "agent" },
      { id: "agent-end", source: "agent", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  await seedState(request, {
    installations: [
      {
        id: "inst-1",
        user_id: "user-1",
        installation_id: 101,
        account_login: "acme",
      },
      {
        id: "inst-2",
        user_id: "user-1",
        installation_id: 202,
        account_login: "alex",
      },
      {
        id: "inst-3",
        user_id: "user-2",
        installation_id: 303,
        account_login: "other",
      },
    ],
    agents: [
      {
        id: "agent-a",
        user_id: "user-1",
        name: "Primary Agent",
        slug: "primary-agent",
        model: "minimax/minimax-m2.5",
        system_prompt: null,
      },
    ],
    flows: [
      {
        id: "flow-source",
        user_id: "user-1",
        installation_id: 101,
        name: "Critical review",
        description: "Extra checks for high-risk repositories.",
        notes: null,
        source_kind: "github",
        status: "inactive",
        draft_graph: sourceGraph,
        published_version_id: null,
        created_at: "2026-07-24T10:00:00.000Z",
        updated_at: "2026-07-24T10:00:00.000Z",
      },
    ],
  });

  const saveResponse = await request.post("/api/flows/templates", {
    headers: user1Headers,
    data: {
      flow_id: "flow-source",
      name: "Strict PR review",
    },
  });
  expect(saveResponse.status()).toBe(201);
  const saved = await saveResponse.json();
  expect(saved.name).toBe("Strict PR review");
  expect(saved.source_flow_id).toBe("flow-source");
  expect(saved.graph).toBeUndefined();
  const stateAfterSave = await getTestState(request);
  expect(stateAfterSave.flowTemplates[0]?.graph.nodes[0]?.data.filter).toEqual({
    scope: "all",
  });

  const ownerList = await request.get("/api/flows/templates", {
    headers: user1Headers,
  });
  expect(ownerList.status()).toBe(200);
  expect((await ownerList.json()).templates).toHaveLength(1);

  const otherUserList = await request.get("/api/flows/templates", {
    headers: user2Headers,
  });
  expect(otherUserList.status()).toBe(200);
  expect(await otherUserList.json()).toEqual({
    templates: [],
    next_cursor: null,
  });

  const createResponse = await request.post("/api/flows", {
    headers: user1Headers,
    data: {
      installation_id: 202,
      personal_template_id: saved.id,
      repo_full_name: "alex/priority-project",
    },
  });
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json();
  expect(created.name).toBe("Strict PR review");
  expect(created.status).toBe("inactive");
  expect(created.published_version_id).toBeNull();
  expect(created.draft_graph.nodes[0].data.filter).toEqual({
    scope: "all",
    installationIds: [202],
    repos: ["alex/priority-project"],
  });

  const forbiddenCreate = await request.post("/api/flows", {
    headers: user2Headers,
    data: {
      installation_id: 303,
      personal_template_id: saved.id,
    },
  });
  expect(forbiddenCreate.status()).toBe(404);
});

test("GET /api/flows/:id enforces ownership", async ({ request }) => {
  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Owned Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "inactive",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: null,
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
  });

  const okResponse = await request.get("/api/flows/flow-1", {
    headers: user1Headers,
  });
  expect(okResponse.ok()).toBeTruthy();

  const missingResponse = await request.get("/api/flows/flow-1", {
    headers: user2Headers,
  });
  expect(missingResponse.status()).toBe(404);
});

test("PUT /api/flows/:id updates metadata and rejects foreign agent bindings", async ({
  request,
}) => {
  await seedState(request, {
    agents: [
      {
        id: "agent-owned",
        user_id: "user-1",
        name: "Owned Agent",
        slug: "owned",
        model: "minimax/minimax-m2.5",
        system_prompt: null,
      },
      {
        id: "agent-foreign",
        user_id: "user-2",
        name: "Foreign Agent",
        slug: "foreign",
        model: "minimax/minimax-m2.5",
        system_prompt: null,
      },
    ],
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "inactive",
        draft_graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "@mention", event: "mention", isDefault: true },
            },
            {
              id: "agent-1",
              type: "agent",
              position: { x: 100, y: 0 },
              data: { label: "Owned Agent", agentId: "agent-owned" },
            },
            {
              id: "end",
              type: "end",
              position: { x: 200, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start", target: "agent-1" },
            { id: "e2", source: "agent-1", target: "end" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: null,
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
  });

  const okResponse = await request.put("/api/flows/flow-1", {
    headers: user1Headers,
    data: {
      name: "Updated Flow",
      description: "Updated description",
      notes: "Updated notes",
      draft_graph: {
        nodes: [
          {
            id: "start",
            type: "start",
            position: { x: 0, y: 0 },
            data: { label: "@mention", event: "mention", isDefault: true },
          },
          {
            id: "agent-1",
            type: "agent",
            position: { x: 100, y: 0 },
            data: { label: "Owned Agent", agentId: "agent-owned" },
          },
          {
            id: "end",
            type: "end",
            position: { x: 200, y: 0 },
            data: { label: "Done" },
          },
        ],
        edges: [
          { id: "e1", source: "start", target: "agent-1" },
          { id: "e2", source: "agent-1", target: "end" },
        ],
        viewport: { x: 5, y: 5, zoom: 1.1 },
      },
    },
  });
  expect(okResponse.ok()).toBeTruthy();
  const updated = await okResponse.json();
  expect(updated.name).toBe("Updated Flow");
  expect(updated.description).toBe("Updated description");
  expect(updated.notes).toBe("Updated notes");

  const badResponse = await request.put("/api/flows/flow-1", {
    headers: user1Headers,
    data: {
      draft_graph: {
        nodes: [
          {
            id: "start",
            type: "start",
            position: { x: 0, y: 0 },
            data: { label: "@mention", event: "mention", isDefault: true },
          },
          {
            id: "agent-1",
            type: "agent",
            position: { x: 100, y: 0 },
            data: { label: "Foreign Agent", agentId: "agent-foreign" },
          },
          {
            id: "end",
            type: "end",
            position: { x: 200, y: 0 },
            data: { label: "Done" },
          },
        ],
        edges: [
          { id: "e1", source: "start", target: "agent-1" },
          { id: "e2", source: "agent-1", target: "end" },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    },
  });
  expect(badResponse.status()).toBe(400);
  expect(await badResponse.json()).toMatchObject({
    code: "FLOW_AGENT_FORBIDDEN",
    error: expect.stringContaining('Agent "agent-foreign"'),
  });
});

test("GET /api/flows/templates pages summaries without returning stored graphs", async ({
  request,
}) => {
  await seedState(request, {
    flowTemplates: Array.from({ length: 26 }, (_, index) => ({
      id: `template-${String(index).padStart(2, "0")}`,
      user_id: "user-1",
      name: `Template ${index + 1}`,
      description: null,
      graph: {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      source_flow_id: null,
      trigger_event: "pr_opened",
      reconnect: [],
      requires_repository: false,
      created_at: `2026-07-24T10:${String(index).padStart(2, "0")}:00.000Z`,
      updated_at: `2026-07-24T10:${String(index).padStart(2, "0")}:00.000Z`,
    })),
  });

  const firstResponse = await request.get("/api/flows/templates", {
    headers: user1Headers,
  });
  expect(firstResponse.status()).toBe(200);
  const firstPage = await firstResponse.json();
  expect(firstPage.templates).toHaveLength(25);
  expect(firstPage.next_cursor).toBe("25");
  expect(firstPage.templates[0].graph).toBeUndefined();

  const secondResponse = await request.get(
    `/api/flows/templates?cursor=${firstPage.next_cursor}`,
    { headers: user1Headers }
  );
  expect(secondResponse.status()).toBe(200);
  expect(await secondResponse.json()).toMatchObject({
    templates: [{ name: "Template 1" }],
    next_cursor: null,
  });

  const invalidResponse = await request.get("/api/flows/templates?cursor=1.5", {
    headers: user1Headers,
  });
  expect(invalidResponse.status()).toBe(400);
});

test("PUT /api/flows/:id updates published flow installation without touching trigger-origin automations", async ({
  request,
}) => {
  await seedState(request, {
    installations: [
      {
        id: "inst-1",
        user_id: "user-1",
        installation_id: 101,
        account_login: "acme",
      },
      {
        id: "inst-2",
        user_id: "user-1",
        installation_id: 202,
        account_login: "acme-2",
      },
    ],
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "inactive",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: "version-1",
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    flowVersions: [
      {
        id: "version-1",
        flow_id: "flow-1",
        version_number: 1,
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        created_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    triggers: [
      {
        id: "trigger-1",
        user_id: "user-1",
        installation_id: 101,
        agent_id: "agent-1",
        event: "mention",
        is_default: true,
        enabled: false,
      },
    ],
  });

  const installResponse = await request.put("/api/flows/flow-1", {
    headers: user1Headers,
    data: {
      installation_id: 202,
    },
  });
  expect(installResponse.ok()).toBeTruthy();

  const activatedResponse = await request.put("/api/flows/flow-1", {
    headers: user1Headers,
    data: { status: "active" },
  });
  expect(activatedResponse.ok()).toBeTruthy();

  const state = await getTestState(request);
  expect(state.flows[0].installation_id).toBe(202);
  expect(state.triggers[0].installation_id).toBe(101);
  expect(state.triggers[0].enabled).toBe(false);
});

test("PUT /api/flows/:id rejects activation for unpublished flows", async ({
  request,
}) => {
  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "inactive",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: null,
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
  });

  const response = await request.put("/api/flows/flow-1", {
    headers: user1Headers,
    data: { status: "active" },
  });

  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({
    code: "FLOW_UNPUBLISHED_ACTIVATION",
    error: "A flow must be published before it can be activated.",
  });
});

test("POST /api/flows/:id/publish atomically applies the draft installation scope", async ({
  request,
}) => {
  await seedState(request, {
    installations: [
      {
        id: "inst-1",
        user_id: "user-1",
        installation_id: 101,
        account_login: "webrenew",
      },
      {
        id: "inst-2",
        user_id: "user-1",
        installation_id: 202,
        account_login: "alex",
      },
    ],
    agents: [
      {
        id: "agent-1",
        user_id: "user-1",
        name: "Reviewer",
        slug: "reviewer",
        model: "minimax/minimax-m2.5",
        system_prompt: null,
      },
    ],
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "inactive",
        draft_graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: {
                label: "PR opened",
                event: "pr_opened",
                isDefault: true,
                filter: {
                  scope: "all",
                  installationIds: [202],
                  repos: ["alex/priority-project"],
                },
              },
            },
            {
              id: "agent-1",
              type: "agent",
              position: { x: 100, y: 0 },
              data: { label: "Reviewer", agentId: "agent-1" },
            },
            {
              id: "end",
              type: "end",
              position: { x: 200, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start", target: "agent-1" },
            { id: "e2", source: "agent-1", target: "end" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: null,
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
  });

  const response = await request.post("/api/flows/flow-1/publish", {
    headers: user1Headers,
  });
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  expect(payload.published_version_id).toBeTruthy();
  expect(payload.status).toBe("active");
  expect(payload.installation_id).toBe(202);

  const state = await getTestState(request);
  expect(state.flowVersions).toHaveLength(1);
  expect(state.flows[0]?.status).toBe("active");
  expect(state.flows[0]?.installation_id).toBe(202);
  expect(state.flowVersions[0]?.graph.nodes[0]?.data.filter).toEqual({
    scope: "all",
    installationIds: [202],
    repos: ["alex/priority-project"],
  });
  expect(state.triggers).toHaveLength(0);
});

test("POST /api/flows/:id/duplicate creates an inactive unlinked copy", async ({
  request,
}) => {
  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Original Flow",
        description: "desc",
        notes: "notes",
        source_kind: "github",
        status: "active",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: "version-1",
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
  });

  const response = await request.post("/api/flows/flow-1/duplicate", {
    headers: user1Headers,
  });
  expect(response.status()).toBe(201);

  const payload = await response.json();
  expect(payload.name).toBe("Original Flow Copy");
  expect(payload.status).toBe("inactive");
  expect(payload.published_version_id).toBeNull();
});

test("DELETE /api/flows/:id deletes the flow and leaves trigger-origin automations untouched", async ({
  request,
}) => {
  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "active",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: "version-1",
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    flowVersions: [
      {
        id: "version-1",
        flow_id: "flow-1",
        version_number: 1,
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        created_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    triggers: [
      {
        id: "trigger-1",
        user_id: "user-1",
        installation_id: 101,
        agent_id: "agent-1",
        event: "mention",
        is_default: true,
        enabled: true,
      },
    ],
  });

  const response = await request.delete("/api/flows/flow-1", {
    headers: user1Headers,
  });
  expect(response.ok()).toBeTruthy();

  const state = await getTestState(request);
  expect(state.flows).toHaveLength(0);
  expect(state.triggers).toHaveLength(1);
});

test("DELETE /api/flows/:id fails cleanly without mutating trigger-origin automations", async ({
  request,
}) => {
  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "active",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: "version-1",
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    flowVersions: [
      {
        id: "version-1",
        flow_id: "flow-1",
        version_number: 1,
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        created_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    triggers: [
      {
        id: "trigger-1",
        user_id: "user-1",
        installation_id: 101,
        agent_id: "agent-1",
        event: "mention",
        is_default: true,
        enabled: true,
      },
    ],
    faults: {
      failNextFlowDelete: "flow delete failed",
    },
  });

  const response = await request.delete("/api/flows/flow-1", {
    headers: user1Headers,
  });
  expect(response.status()).toBe(500);
  expect(await response.json()).toMatchObject({
    code: "FLOW_DELETE_SYNC_FAILED",
    error: "flow delete failed",
  });

  const state = await getTestState(request);
  expect(state.flows).toHaveLength(1);
  expect(state.triggers).toHaveLength(1);
  expect(state.triggers[0].id).toBe("trigger-1");
});

test("POST /api/flows/:id/assistant validates request and response graphs", async ({
  request,
}) => {
  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "inactive",
        draft_graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "@mention", event: "mention", isDefault: true },
            },
            {
              id: "agent-1",
              type: "agent",
              position: { x: 100, y: 0 },
              data: { label: "Agent", agentId: "agent-1" },
            },
            {
              id: "end",
              type: "end",
              position: { x: 200, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start", target: "agent-1" },
            { id: "e2", source: "agent-1", target: "end" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: null,
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    assistant: {
      nextResult: {
        summary: "Added a parallel reviewer",
        graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "@mention", event: "mention", isDefault: true },
            },
            {
              id: "agent-1",
              type: "agent",
              position: { x: 100, y: 0 },
              data: { label: "Agent", agentId: "agent-1" },
            },
            {
              id: "end",
              type: "end",
              position: { x: 200, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start", target: "agent-1" },
            { id: "e2", source: "agent-1", target: "end" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    },
  });

  const successResponse = await request.post("/api/flows/flow-1/assistant", {
    headers: user1Headers,
    data: { message: "Keep it simple" },
  });
  expect(successResponse.ok()).toBeTruthy();
  expect(await successResponse.json()).toMatchObject({
    summary: "Added a parallel reviewer",
  });

  const missingMessage = await request.post("/api/flows/flow-1/assistant", {
    headers: user1Headers,
    data: { message: "" },
  });
  expect(missingMessage.status()).toBe(400);

  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "inactive",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: null,
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    assistant: {
      nextResult: {
        summary: "Broken graph",
        graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "@mention", event: "mention", isDefault: true },
            },
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    },
  });

  const invalidGraph = await request.post("/api/flows/flow-1/assistant", {
    headers: user1Headers,
    data: { message: "Break it" },
  });
  expect(invalidGraph.status()).toBe(400);
  expect(await invalidGraph.json()).toMatchObject({
    code: "FLOW_ASSISTANT_INVALID_GRAPH",
    error: "Assistant produced an invalid flow graph",
  });
});
