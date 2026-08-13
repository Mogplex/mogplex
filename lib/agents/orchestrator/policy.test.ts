import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "./helpers";
import {
  wrapWithPolicy,
  type PolicyApprovalDeps,
  type PolicyDeniedResponse,
} from "./policy";
import { createRequestApprovalTool } from "./tools/governance-impl";
import type { OrchestratorToolContext } from "./types";

const ctx: OrchestratorToolContext = {
  userId: "user-1",
  missionId: "mission-1",
  aiCallId: "call-1",
  repoBranch: "feat/work",
  repoBaseBranch: "main",
};

type WrappedTool = {
  needsApproval?: (
    input: unknown,
    options: { toolCallId: string }
  ) => Promise<boolean>;
  execute: (
    input: unknown,
    options?: { toolCallId?: string }
  ) => Promise<unknown>;
};

function makeDeps(overrides?: Partial<PolicyApprovalDeps>): {
  deps: PolicyApprovalDeps;
  created: Array<Record<string, unknown>>;
  resolved: string[];
} {
  const created: Array<Record<string, unknown>> = [];
  const resolved: string[] = [];
  const deps: PolicyApprovalDeps = {
    createApproval: async (input) => {
      created.push(input as unknown as Record<string, unknown>);
      return { id: `approval-${created.length}` };
    },
    resolveApprovalByToolCall: async (input) => {
      resolved.push(input.toolCallId);
    },
    ...overrides,
  };
  return { deps, created, resolved };
}

function fakeTool(onExecute?: (input: unknown) => unknown) {
  const calls: unknown[] = [];
  const tool = defineTool({
    description: "fake",
    parameters: z.object({ path: z.string().optional() }),
    execute: async (input: unknown) => {
      calls.push(input);
      return onExecute ? onExecute(input) : { ok: true };
    },
  });
  return { tool, calls };
}

describe("wrapWithPolicy approval gate", () => {
  it("preserves the input schema of implemented tools", () => {
    const inputSchema = z.object({ repoId: z.string() });
    const original = defineTool({
      description: "start compute",
      inputSchema,
      execute: async () => ({ ok: true }),
    });

    const wrapped = wrapWithPolicy(
      "sandbox_start",
      original,
      ctx
    ) as unknown as { inputSchema?: unknown };
    expect(wrapped.inputSchema).toBe(inputSchema);
  });

  it("should expose needsApproval on always-approval tools and persist the request", async () => {
    const { deps, created } = makeDeps();
    const { tool } = fakeTool();
    const wrapped = wrapWithPolicy(
      "delete_file",
      tool,
      ctx,
      deps
    ) as unknown as WrappedTool;

    expect(typeof wrapped.needsApproval).toBe("function");
    const needed = await wrapped.needsApproval?.(
      { path: "lib/old.ts" },
      { toolCallId: "tc-1" }
    );
    expect(needed).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      userId: "user-1",
      toolName: "delete_file",
      toolCallId: "tc-1",
      runId: "mission-1",
      aiCallId: "call-1",
    });
  });

  it("should not gate ordinary mutations", async () => {
    const { deps, created } = makeDeps();
    const { tool, calls } = fakeTool();
    const wrapped = wrapWithPolicy(
      "write_file",
      tool,
      ctx,
      deps
    ) as unknown as WrappedTool;

    expect(wrapped.needsApproval).toBeUndefined();
    const result = await wrapped.execute({ path: "lib/new.ts" });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(created).toHaveLength(0);
  });

  it("should hard-deny mutating tools in plan mode", async () => {
    const { deps } = makeDeps();
    const { tool, calls } = fakeTool();
    const wrapped = wrapWithPolicy(
      "write_file",
      tool,
      { ...ctx, controlMode: "plan" },
      deps
    ) as unknown as WrappedTool;

    const result = (await wrapped.execute({
      path: "lib/new.ts",
    })) as PolicyDeniedResponse;
    expect(result.status).toBe("policy_denied");
    expect(result.reason).toBe("policy_violation");
    expect(result.summary).toContain("Plan mode blocks");
    expect(calls).toHaveLength(0);
  });

  it("should allow plan mode to persist the mission plan", async () => {
    const { deps } = makeDeps();
    const { tool, calls } = fakeTool();
    const wrapped = wrapWithPolicy(
      "plan_mission",
      tool,
      { ...ctx, controlMode: "plan" },
      deps
    ) as unknown as WrappedTool;

    expect(await wrapped.execute({ objective: "Plan it", tasks: [] })).toEqual({
      ok: true,
    });
    expect(calls).toHaveLength(1);
  });

  it.each([
    "sandbox_start",
    "run_command",
    "spawn_worktree",
    "spawn_subagent",
    "archive_worktree",
  ])("should block %s resource mutations in plan mode", async (toolName) => {
    const { deps } = makeDeps();
    const { tool, calls } = fakeTool();
    const wrapped = wrapWithPolicy(
      toolName,
      tool,
      { ...ctx, controlMode: "plan" },
      deps
    ) as unknown as WrappedTool;

    const result = (await wrapped.execute({})) as PolicyDeniedResponse;
    expect(result).toMatchObject({
      status: "policy_denied",
      reason: "policy_violation",
    });
    expect(calls).toHaveLength(0);
  });

  it("should gate git_push only for protected branches", async () => {
    const { deps, created } = makeDeps();
    const { tool } = fakeTool();
    const wrapped = wrapWithPolicy(
      "git_push",
      tool,
      ctx,
      deps
    ) as unknown as WrappedTool;

    expect(
      await wrapped.needsApproval?.({ branch: "main" }, { toolCallId: "tc-2" })
    ).toBe(true);
    expect(
      await wrapped.needsApproval?.(
        { branch: "feat/work" },
        { toolCallId: "tc-3" }
      )
    ).toBe(false);
    expect(created).toHaveLength(1);
  });

  it("should still require approval when persistence fails (gate never skips)", async () => {
    const { deps } = makeDeps({
      createApproval: async () => {
        throw new Error("db down");
      },
    });
    const { tool } = fakeTool();
    const wrapped = wrapWithPolicy(
      "delete_file",
      tool,
      ctx,
      deps
    ) as unknown as WrappedTool;
    expect(
      await wrapped.needsApproval?.({ path: "x" }, { toolCallId: "tc-4" })
    ).toBe(true);
  });

  it("should hard-deny protected-branch mutations without executing", async () => {
    const { deps } = makeDeps();
    const { tool, calls } = fakeTool();
    const wrapped = wrapWithPolicy(
      "git_commit",
      tool,
      ctx,
      deps
    ) as unknown as WrappedTool;

    const result = (await wrapped.execute({
      branch: "main",
    })) as PolicyDeniedResponse;
    expect(result.status).toBe("policy_denied");
    expect(result.reason).toBe("protected_branch");
    expect(calls).toHaveLength(0);
  });

  it("should resolve the audit row when an approved call executes", async () => {
    const { deps, resolved } = makeDeps();
    const { tool, calls } = fakeTool();
    const wrapped = wrapWithPolicy(
      "delete_file",
      tool,
      ctx,
      deps
    ) as unknown as WrappedTool;

    // The SDK only calls execute after the operator approved in-stream.
    const result = await wrapped.execute(
      { path: "lib/old.ts" },
      { toolCallId: "tc-5" }
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(resolved).toEqual(["tc-5"]);
  });
});

describe("createRequestApprovalTool", () => {
  it("should persist an approval row and return pending", async () => {
    const created: Array<Record<string, unknown>> = [];
    const tool = createRequestApprovalTool(ctx, {
      createApproval: async (input) => {
        created.push(input as unknown as Record<string, unknown>);
        return { id: "approval-9" };
      },
    }) as unknown as WrappedTool;

    const result = (await tool.execute({
      action: "merge the integration branch",
      reason: "all tasks merged and validated",
    })) as { status: string; approvalId: string };

    expect(result.status).toBe("pending");
    expect(result.approvalId).toBe("approval-9");
    expect(created[0]).toMatchObject({
      toolName: "request_approval",
      userId: "user-1",
      runId: "mission-1",
    });
    expect(String(created[0].toolCallId)).toMatch(/^request-approval-/);
  });

  it("should report errors without throwing into the agent loop", async () => {
    const tool = createRequestApprovalTool(ctx, {
      createApproval: async () => {
        throw new Error("db down");
      },
    }) as unknown as WrappedTool;
    const result = (await tool.execute({
      action: "x",
      reason: "y",
    })) as { status: string; error: string };
    expect(result.status).toBe("error");
    expect(result.error).toContain("db down");
  });
});
