import { expect, test } from "@playwright/test";
import {
  user1Headers,
  seedState,
  resetState,
  getTestState,
} from "./helpers/flows-api-fixtures";

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
