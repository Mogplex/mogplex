import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import type { OrchestrationRunDTO } from "../../lib/orchestrations/types";

async function loadOrchestrationsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/orchestrations/route");
}

const RUN_ID = "11111111-2222-4333-8444-555555555555";
const REPO_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function buildRun(
  overrides: Partial<OrchestrationRunDTO> = {}
): OrchestrationRunDTO {
  return {
    id: RUN_ID,
    user_id: "user-123",
    workspace_id: null,
    repo_id: REPO_ID,
    title: "Fix login",
    slug: "fix-login",
    status: "drafting_master_spec",
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

function buildCreateRequest(body: unknown) {
  return new Request("https://app.mogplex.com/api/orchestrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validCreateBody() {
  return {
    repoId: REPO_ID,
    title: "Fix login",
    request: "fix the login flow",
  };
}

test("GET /api/orchestrations lists the caller's runs with filters", async () => {
  const { createOrchestrationsGetHandler } = await loadOrchestrationsRoute();
  const seen: Array<Record<string, unknown>> = [];
  const handler = createOrchestrationsGetHandler({
    requireUserId: async () => "user-123",
    listOrchestrationRuns: async (input) => {
      seen.push(input as unknown as Record<string, unknown>);
      return [buildRun()];
    },
  });
  const response = await handler(
    new Request(
      `https://app.mogplex.com/api/orchestrations?repoId=${REPO_ID}&limit=5`
    )
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { runs: OrchestrationRunDTO[] };
  assert.equal(body.runs.length, 1);
  assert.equal(body.runs[0].id, RUN_ID);
  assert.partialDeepStrictEqual(seen[0], {
    userId: "user-123",
    repoId: REPO_ID,
    limit: 5,
  });
});

test("GET ignores a non-numeric limit instead of failing", async () => {
  const { createOrchestrationsGetHandler } = await loadOrchestrationsRoute();
  const seen: Array<Record<string, unknown>> = [];
  const handler = createOrchestrationsGetHandler({
    requireUserId: async () => "user-123",
    listOrchestrationRuns: async (input) => {
      seen.push(input as unknown as Record<string, unknown>);
      return [];
    },
  });
  const response = await handler(
    new Request("https://app.mogplex.com/api/orchestrations?limit=banana")
  );
  assert.equal(response.status, 200);
  assert.equal(seen[0].limit, undefined);
});

test("GET returns the auth response when the caller is not signed in", async () => {
  const { createOrchestrationsGetHandler } = await loadOrchestrationsRoute();
  const handler = createOrchestrationsGetHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    listOrchestrationRuns: async () => {
      throw new Error("must not be called");
    },
  });
  const response = await handler(
    new Request("https://app.mogplex.com/api/orchestrations")
  );
  assert.equal(response.status, 401);
});

test("POST creates a run scoped to the owned repo", async () => {
  const { createOrchestrationsPostHandler } = await loadOrchestrationsRoute();
  const created: Array<Record<string, unknown>> = [];
  const handler = createOrchestrationsPostHandler({
    requireUserId: async () => "user-123",
    getOwnedRepo: async () => ({ id: REPO_ID, default_branch: "develop" }),
    createOrchestrationRun: async (input) => {
      created.push(input as unknown as Record<string, unknown>);
      return buildRun({ base_branch: "develop" });
    },
  });
  const response = await handler(buildCreateRequest(validCreateBody()));
  assert.equal(response.status, 201);
  const body = (await response.json()) as { run: OrchestrationRunDTO };
  assert.equal(body.run.id, RUN_ID);
  assert.partialDeepStrictEqual(created[0], {
    userId: "user-123",
    repoId: REPO_ID,
    title: "Fix login",
    request: "fix the login flow",
    // No baseBranch in the body -> the repo's default branch wins.
    baseBranch: "develop",
  });
});

test("POST falls back to main when the repo has no default branch", async () => {
  const { createOrchestrationsPostHandler } = await loadOrchestrationsRoute();
  const created: Array<Record<string, unknown>> = [];
  const handler = createOrchestrationsPostHandler({
    requireUserId: async () => "user-123",
    getOwnedRepo: async () => ({ id: REPO_ID, default_branch: null }),
    createOrchestrationRun: async (input) => {
      created.push(input as unknown as Record<string, unknown>);
      return buildRun();
    },
  });
  const response = await handler(buildCreateRequest(validCreateBody()));
  assert.equal(response.status, 201);
  assert.equal(created[0].baseBranch, "main");
});

test("POST honors an explicit base branch and approval mode", async () => {
  const { createOrchestrationsPostHandler } = await loadOrchestrationsRoute();
  const created: Array<Record<string, unknown>> = [];
  const handler = createOrchestrationsPostHandler({
    requireUserId: async () => "user-123",
    getOwnedRepo: async () => ({ id: REPO_ID, default_branch: "main" }),
    createOrchestrationRun: async (input) => {
      created.push(input as unknown as Record<string, unknown>);
      return buildRun();
    },
  });
  const response = await handler(
    buildCreateRequest({
      ...validCreateBody(),
      baseBranch: "release/2026-08",
      approvalMode: "auto_dispatch",
    })
  );
  assert.equal(response.status, 201);
  assert.partialDeepStrictEqual(created[0], {
    baseBranch: "release/2026-08",
    approvalMode: "auto_dispatch",
  });
});

test("POST returns 404 for a repo the caller does not own", async () => {
  const { createOrchestrationsPostHandler } = await loadOrchestrationsRoute();
  const handler = createOrchestrationsPostHandler({
    requireUserId: async () => "user-123",
    getOwnedRepo: async () => null,
    createOrchestrationRun: async () => {
      throw new Error("must not be called");
    },
  });
  const response = await handler(buildCreateRequest(validCreateBody()));
  assert.equal(response.status, 404);
});

test("POST rejects malformed bodies before touching the store", async () => {
  const { createOrchestrationsPostHandler } = await loadOrchestrationsRoute();
  const handler = createOrchestrationsPostHandler({
    requireUserId: async () => "user-123",
    getOwnedRepo: async () => ({ id: REPO_ID, default_branch: "main" }),
    createOrchestrationRun: async () => {
      throw new Error("must not be called");
    },
  });

  const cases: Array<{ label: string; body: unknown }> = [
    { label: "missing title", body: { repoId: REPO_ID, request: "x" } },
    {
      label: "blank request",
      body: { repoId: REPO_ID, title: "Fix", request: "   " },
    },
    {
      label: "title over 500 chars",
      body: { repoId: REPO_ID, title: "x".repeat(501), request: "x" },
    },
    {
      label: "unknown approval mode",
      body: { ...validCreateBody(), approvalMode: "yolo" },
    },
    {
      label: "invalid base branch",
      body: { ...validCreateBody(), baseBranch: "not a branch" },
    },
    { label: "missing repoId", body: { title: "Fix", request: "x" } },
  ];
  for (const { label, body } of cases) {
    const response = await handler(buildCreateRequest(body));
    assert.equal(response.status, 400, label);
  }
});
