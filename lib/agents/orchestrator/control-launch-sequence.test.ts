import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createStartSandbox } from "@/lib/agents/tools/sandbox";
import { createSpawnWorktreeToolWithDeps } from "./tools/worktree-impl";
import { createSpawnSubagentTool } from "./tools/planning-impl";
import type { OrchestratorToolContext } from "./types";
import type { OrchestrationWorktreeDTO } from "@/lib/worktrees/types";

type ExecutableTool = {
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

const REPO_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const WORKTREE_ID = "44444444-4444-4444-8444-444444444444";
const NEW_SANDBOX_ID = "55555555-5555-4555-8555-555555555555";

let supabaseAdmin: typeof import("@/lib/supabase/admin").supabaseAdmin;
let originalFrom: typeof supabaseAdmin.from;
const originalFetch = global.fetch;
const originalSecret = process.env.INTERNAL_API_SECRET;
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  ({ supabaseAdmin } = await import("@/lib/supabase/admin"));
  originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
});

afterAll(() => {
  if (originalSupabaseUrl === undefined)
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  if (originalServiceRoleKey === undefined)
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
});

beforeEach(() => {
  process.env.INTERNAL_API_SECRET = "internal-secret";
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: async () => ({ data: [], error: null }),
  };
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: () => query,
  });
});

afterEach(() => {
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: originalFrom,
  });
  global.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
  else process.env.INTERNAL_API_SECRET = originalSecret;
});

function buildWorktree(): OrchestrationWorktreeDTO {
  return {
    id: WORKTREE_ID,
    user_id: "user-1",
    run_id: RUN_ID,
    task_id: TASK_ID,
    repo_id: REPO_ID,
    sandbox_id: NEW_SANDBOX_ID,
    agent_id: null,
    branch_name: "mogplex/task/fix-control/lifecycle",
    base_branch: "main",
    checkout_path: "/vercel/sandbox/.worktrees/lifecycle",
    status: "active",
    latest_commit_sha: null,
    error: null,
    metadata: {},
    created_at: "2026-08-20T12:00:00.000Z",
    updated_at: "2026-08-20T12:00:00.000Z",
    archived_at: null,
    pruned_at: null,
  };
}

describe("Control launch sequence", () => {
  it("rebinds a stopped selection before one worktree and one worker start", async () => {
    const fetchSandbox = vi.fn(
      async () =>
        new Response(
          [
            `data: ${JSON.stringify({ type: "sandbox_created", recordId: NEW_SANDBOX_ID })}`,
            `data: ${JSON.stringify({ type: "ready", sandbox: { id: NEW_SANDBOX_ID } })}`,
            "",
          ].join("\n\n"),
          { headers: { "Content-Type": "text/event-stream" } }
        )
    );
    global.fetch = fetchSandbox;

    const ctx: OrchestratorToolContext = {
      userId: "user-1",
      repoId: REPO_ID,
      orchestrationRunId: RUN_ID,
      sandboxId: "sandbox-stopped",
      sandboxBinding: { sandboxId: null, status: "unavailable" },
      conversationId: "conversation-1",
    };
    const start = createStartSandbox("user-1", REPO_ID, (resolution) => {
      ctx.sandboxId = resolution.sandboxId;
      if (ctx.sandboxBinding) {
        ctx.sandboxBinding.sandboxId = resolution.sandboxId;
        ctx.sandboxBinding.status = resolution.status;
      }
    }) as unknown as ExecutableTool;

    await expect(start.execute({})).resolves.toMatchObject({
      ok: true,
      sandboxId: NEW_SANDBOX_ID,
      status: "running",
    });
    expect(fetchSandbox).toHaveBeenCalledTimes(1);
    expect(ctx.sandboxBinding).toEqual({
      sandboxId: NEW_SANDBOX_ID,
      status: "running",
    });

    const spawnWorktree = vi.fn(async () => buildWorktree());
    const worktreeTool = createSpawnWorktreeToolWithDeps(ctx, {
      spawnWorktree,
    }) as unknown as ExecutableTool;
    await expect(
      worktreeTool.execute({ taskId: TASK_ID })
    ).resolves.toMatchObject({ status: "ok" });
    expect(spawnWorktree).toHaveBeenCalledTimes(1);
    expect(spawnWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxId: NEW_SANDBOX_ID })
    );

    const startRun = vi.fn(async () => ({
      replayed: false,
      run: {
        runId: "66666666-6666-4666-8666-666666666666",
        aiCallId: "77777777-7777-4777-8777-777777777777",
        worktreeId: WORKTREE_ID,
      },
    }));
    const workerTool = createSpawnSubagentTool(ctx, {
      loadWorktree: async () => buildWorktree(),
      startRun: startRun as never,
      bindAgent: async () => buildWorktree(),
    }) as unknown as ExecutableTool;
    await expect(
      workerTool.execute({
        worktreeId: WORKTREE_ID,
        taskPrompt: "Implement the lifecycle fix",
        agentType: "codex",
      })
    ).resolves.toMatchObject({ status: "ok" });
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ worktreeId: WORKTREE_ID }),
      })
    );
  });
});
