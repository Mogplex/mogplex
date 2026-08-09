import assert from "node:assert/strict";
import test from "node:test";
import type { OrchestrationRunDTO } from "../../lib/orchestrations/types";

async function loadRunRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/orchestrations/[runId]/route");
}

const RUN_ID = "11111111-2222-4333-8444-555555555555";
const routeParams = { params: Promise.resolve({ runId: RUN_ID }) };

function buildRun(
  overrides: Partial<OrchestrationRunDTO> = {}
): OrchestrationRunDTO {
  return {
    id: RUN_ID,
    user_id: "user-123",
    workspace_id: null,
    repo_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    title: "Fix login",
    slug: "fix-login",
    status: "running_tasks",
    request: "fix the login flow",
    base_branch: "main",
    root_directory: null,
    spec_branch: "mogplex/spec/fix-login",
    integration_branch: "mogplex/integrate/fix-login",
    approval_mode: "manual",
    master_spec_path: null,
    master_spec_blob_sha: null,
    planner_sandbox_id: null,
    integration_sandbox_id: null,
    github_pr_number: null,
    github_pr_url: null,
    error: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildJsonRequest(method: string, body?: unknown) {
  return new Request(`https://app.mogplex.com/api/orchestrations/${RUN_ID}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("GET returns the run with specs, tasks, and events", async () => {
  const { createOrchestrationRunGetHandler } = await loadRunRoute();
  const seen: Array<Record<string, unknown>> = [];
  const handler = createOrchestrationRunGetHandler({
    requireUserId: async () => "user-123",
    getOrchestrationRunDetails: async (input) => {
      seen.push(input as unknown as Record<string, unknown>);
      return {
        run: buildRun(),
        specs: [],
        tasks: [],
        events: [],
        mergeEvents: [],
      };
    },
  });
  const response = await handler(buildJsonRequest("GET"), routeParams);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { run: OrchestrationRunDTO };
  assert.equal(body.run.id, RUN_ID);
  assert.partialDeepStrictEqual(seen[0], {
    runId: RUN_ID,
    userId: "user-123",
  });
});

test("GET returns 404 for a run the caller cannot see", async () => {
  const { createOrchestrationRunGetHandler } = await loadRunRoute();
  const handler = createOrchestrationRunGetHandler({
    requireUserId: async () => "user-123",
    getOrchestrationRunDetails: async () => null,
  });
  const response = await handler(buildJsonRequest("GET"), routeParams);
  assert.equal(response.status, 404);
});

test("PATCH updates approval mode and metadata and returns the run", async () => {
  const { createOrchestrationRunPatchHandler } = await loadRunRoute();
  const seen: Array<Record<string, unknown>> = [];
  const handler = createOrchestrationRunPatchHandler({
    requireUserId: async () => "user-123",
    updateOrchestrationRun: async (input) => {
      seen.push(input as unknown as Record<string, unknown>);
      return buildRun({
        approval_mode: "auto_dispatch",
        metadata: { pinned: true },
      });
    },
  });
  const response = await handler(
    buildJsonRequest("PATCH", {
      approvalMode: "auto_dispatch",
      metadata: { pinned: true },
    }),
    routeParams
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { run: OrchestrationRunDTO };
  assert.equal(body.run.approval_mode, "auto_dispatch");
  assert.partialDeepStrictEqual(seen[0], {
    runId: RUN_ID,
    userId: "user-123",
    approvalMode: "auto_dispatch",
    metadataPatch: { pinned: true },
  });
});

test("PATCH rejects bodies with no recognized fields", async () => {
  const { createOrchestrationRunPatchHandler } = await loadRunRoute();
  const handler = createOrchestrationRunPatchHandler({
    requireUserId: async () => "user-123",
    updateOrchestrationRun: async () => {
      throw new Error("must not be called");
    },
  });
  for (const body of [{}, { status: "completed" }, { title: "" }]) {
    const response = await handler(
      buildJsonRequest("PATCH", body),
      routeParams
    );
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

test("PATCH rejects an unknown approval mode", async () => {
  const { createOrchestrationRunPatchHandler } = await loadRunRoute();
  const handler = createOrchestrationRunPatchHandler({
    requireUserId: async () => "user-123",
    updateOrchestrationRun: async () => {
      throw new Error("must not be called");
    },
  });
  const response = await handler(
    buildJsonRequest("PATCH", { approvalMode: "yolo" }),
    routeParams
  );
  assert.equal(response.status, 400);
});

test("PATCH returns 404 when the run is not visible to the caller", async () => {
  const { createOrchestrationRunPatchHandler } = await loadRunRoute();
  const handler = createOrchestrationRunPatchHandler({
    requireUserId: async () => "user-123",
    updateOrchestrationRun: async () => null,
  });
  const response = await handler(
    buildJsonRequest("PATCH", { title: "New title" }),
    routeParams
  );
  assert.equal(response.status, 404);
});

test("DELETE cancels the run and reports it", async () => {
  const { createOrchestrationRunDeleteHandler } = await loadRunRoute();
  const seen: Array<Record<string, unknown>> = [];
  const handler = createOrchestrationRunDeleteHandler({
    requireUserId: async () => "user-123",
    cancelOrchestrationRun: async (input) => {
      seen.push(input as unknown as Record<string, unknown>);
      return {
        outcome: "cancelled" as const,
        run: buildRun({ status: "cancelled" }),
      };
    },
  });
  const response = await handler(buildJsonRequest("DELETE"), routeParams);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    run: OrchestrationRunDTO;
  };
  assert.equal(body.ok, true);
  assert.equal(body.run.status, "cancelled");
  assert.partialDeepStrictEqual(seen[0], {
    runId: RUN_ID,
    userId: "user-123",
  });
});

test("DELETE is idempotent for an already-cancelled run", async () => {
  const { createOrchestrationRunDeleteHandler } = await loadRunRoute();
  const handler = createOrchestrationRunDeleteHandler({
    requireUserId: async () => "user-123",
    cancelOrchestrationRun: async () => ({
      outcome: "already_cancelled" as const,
      run: buildRun({ status: "cancelled" }),
    }),
  });
  const response = await handler(buildJsonRequest("DELETE"), routeParams);
  assert.equal(response.status, 200);
});

test("DELETE returns 409 for a completed run", async () => {
  const { createOrchestrationRunDeleteHandler } = await loadRunRoute();
  const handler = createOrchestrationRunDeleteHandler({
    requireUserId: async () => "user-123",
    cancelOrchestrationRun: async () => ({
      outcome: "not_cancellable" as const,
      run: buildRun({ status: "completed" }),
    }),
  });
  const response = await handler(buildJsonRequest("DELETE"), routeParams);
  assert.equal(response.status, 409);
});

test("malformed runId returns 404 without touching the store", async () => {
  const {
    createOrchestrationRunGetHandler,
    createOrchestrationRunPatchHandler,
    createOrchestrationRunDeleteHandler,
  } = await loadRunRoute();
  const mustNotBeCalled = async () => {
    throw new Error("store must not be called for a malformed runId");
  };
  const badParams = { params: Promise.resolve({ runId: "not-a-uuid" }) };

  const getResponse = await createOrchestrationRunGetHandler({
    requireUserId: async () => "user-123",
    getOrchestrationRunDetails: mustNotBeCalled,
  })(buildJsonRequest("GET"), badParams);
  assert.equal(getResponse.status, 404);

  const patchResponse = await createOrchestrationRunPatchHandler({
    requireUserId: async () => "user-123",
    updateOrchestrationRun: mustNotBeCalled,
  })(buildJsonRequest("PATCH", { title: "New title" }), badParams);
  assert.equal(patchResponse.status, 404);

  const deleteResponse = await createOrchestrationRunDeleteHandler({
    requireUserId: async () => "user-123",
    cancelOrchestrationRun: mustNotBeCalled,
  })(buildJsonRequest("DELETE"), badParams);
  assert.equal(deleteResponse.status, 404);
});

test("DELETE returns 404 when the run does not exist for the caller", async () => {
  const { createOrchestrationRunDeleteHandler } = await loadRunRoute();
  const handler = createOrchestrationRunDeleteHandler({
    requireUserId: async () => "user-123",
    cancelOrchestrationRun: async () => ({ outcome: "not_found" as const }),
  });
  const response = await handler(buildJsonRequest("DELETE"), routeParams);
  assert.equal(response.status, 404);
});
