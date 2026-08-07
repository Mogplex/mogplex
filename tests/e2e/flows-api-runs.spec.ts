import { expect, test } from "@playwright/test";
import {
  user1Headers,
  seedState,
  resetState,
} from "./helpers/flows-api-fixtures";

test.beforeEach(async ({ request }) => {
  await resetState(request);
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
