import assert from "node:assert/strict";
import test from "node:test";
import type { OrchestrationWorktreeDTO } from "../../lib/worktrees/types";

const WORKTREE_ID = "11111111-2222-4333-8444-555555555555";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const REPO_ID = "33333333-3333-4333-8333-333333333333";

async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/control/worktrees/route");
}

function buildWorktree(
  overrides: Partial<OrchestrationWorktreeDTO> = {}
): OrchestrationWorktreeDTO {
  return {
    id: WORKTREE_ID,
    user_id: "user-1",
    run_id: RUN_ID,
    task_id: "44444444-4444-4444-8444-444444444444",
    repo_id: REPO_ID,
    sandbox_id: "55555555-5555-4555-8555-555555555555",
    agent_id: null,
    branch_name: "mogplex/task/mission/code",
    base_branch: "main",
    checkout_path: `/vercel/sandbox/.worktrees/${WORKTREE_ID}`,
    status: "active",
    latest_commit_sha: null,
    error: null,
    metadata: {},
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
    archived_at: null,
    pruned_at: null,
    ...overrides,
  };
}

test("GET lists only the server-owned session run worktrees", async () => {
  const { createControlWorktreesGetHandler } = await loadRoute();
  const seen: unknown[] = [];
  const handler = createControlWorktreesGetHandler({
    requireUserId: async () => "user-1",
    loadSession: async (input) => {
      seen.push(input);
      return { repo_id: REPO_ID, orchestration_run_id: RUN_ID };
    },
    list: async (input) => {
      seen.push(input);
      return [buildWorktree()];
    },
  });
  const response = await handler(
    new Request(
      "https://app.mogplex.com/api/control/worktrees?sessionId=session-1"
    )
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { worktrees: [buildWorktree()] });
  assert.deepEqual(seen, [
    { userId: "user-1", sessionId: "session-1" },
    { userId: "user-1", runId: RUN_ID, repoId: REPO_ID },
  ]);
});

test("GET returns zero worktrees for a session without a mission run", async () => {
  const { createControlWorktreesGetHandler } = await loadRoute();
  const handler = createControlWorktreesGetHandler({
    requireUserId: async () => "user-1",
    loadSession: async () => ({ repo_id: null, orchestration_run_id: null }),
    list: async () => {
      throw new Error("must not list");
    },
  });
  const response = await handler(
    new Request(
      "https://app.mogplex.com/api/control/worktrees?sessionId=session-1"
    )
  );
  assert.deepEqual(await response.json(), { worktrees: [] });
});

test("GET diff is forced through the owned worktree service", async () => {
  const { createControlWorktreesGetHandler } = await loadRoute();
  const handler = createControlWorktreesGetHandler({
    requireUserId: async () => "user-1",
    loadSession: async () => ({
      repo_id: REPO_ID,
      orchestration_run_id: RUN_ID,
    }),
    diff: async (input) => {
      assert.deepEqual(input, {
        userId: "user-1",
        worktreeId: WORKTREE_ID,
        runId: RUN_ID,
        repoId: REPO_ID,
      });
      return { worktree: buildWorktree(), diff: "diff --git a/a b/a" };
    },
  });
  const response = await handler(
    new Request(
      `https://app.mogplex.com/api/control/worktrees?sessionId=session-1&worktreeId=${WORKTREE_ID}`
    )
  );
  assert.equal((await response.json()).diff, "diff --git a/a b/a");
});

test("POST routes explicit lifecycle actions without sandbox mutations", async () => {
  const { createControlWorktreesPostHandler } = await loadRoute();
  const actions: string[] = [];
  const handler = createControlWorktreesPostHandler({
    requireUserId: async () => "user-1",
    loadSession: async () => ({
      repo_id: REPO_ID,
      orchestration_run_id: RUN_ID,
    }),
    rebase: async () => {
      actions.push("rebase");
      return buildWorktree();
    },
    archive: async () => {
      actions.push("archive");
      return buildWorktree({ status: "archived" });
    },
    prune: async () => {
      actions.push("prune");
      return buildWorktree({ status: "pruned" });
    },
  });

  for (const action of ["rebase", "archive", "prune"]) {
    const response = await handler(
      new Request("https://app.mogplex.com/api/control/worktrees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          worktreeId: WORKTREE_ID,
          sessionId: "session-1",
        }),
      })
    );
    assert.equal(response.status, 200);
  }
  assert.deepEqual(actions, ["rebase", "archive", "prune"]);
});

test("POST rejects lifecycle actions without an owned mission session", async () => {
  const { createControlWorktreesPostHandler } = await loadRoute();
  const handler = createControlWorktreesPostHandler({
    requireUserId: async () => "user-1",
    loadSession: async () => null,
    archive: async () => {
      throw new Error("must not archive");
    },
  });
  const response = await handler(
    new Request("https://app.mogplex.com/api/control/worktrees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "archive",
        worktreeId: WORKTREE_ID,
        sessionId: "not-owned",
      }),
    })
  );
  assert.equal(response.status, 404);
});
