import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "./helpers";
import { wrapWithPolicy, type PolicyApprovalDeps } from "./policy";
import type { OrchestratorToolContext } from "./types";

const ctx: OrchestratorToolContext = {
  userId: "user-1",
  missionId: "mission-1",
  aiCallId: "call-1",
  controlMode: "run",
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

function setup(risky: boolean, context: OrchestratorToolContext = ctx) {
  const created: Array<Record<string, unknown>> = [];
  const resolved: string[] = [];
  const assessed: string[] = [];
  const executed: unknown[] = [];
  const deps: PolicyApprovalDeps = {
    createApproval: async (input) => {
      created.push(input as unknown as Record<string, unknown>);
      return { id: "approval-1" };
    },
    resolveApprovalByToolCall: async (input) => {
      resolved.push(input.toolCallId);
    },
    isRiskyCommand: async (command) => {
      assessed.push(command);
      return risky;
    },
  };
  const tool = defineTool({
    description: "run",
    inputSchema: z.object({ command: z.string() }),
    execute: async (input: unknown) => {
      executed.push(input);
      return { exitCode: 0 };
    },
  });
  const wrapped = wrapWithPolicy(
    "run_command",
    tool,
    context,
    deps
  ) as unknown as WrappedTool;
  return { wrapped, created, resolved, assessed, executed };
}

describe("run_command risk gate", () => {
  it("should require approval and persist the request when a command is remote-destructive", async () => {
    const { wrapped, created, assessed } = setup(true);

    const needed = await wrapped.needsApproval?.(
      { command: "git push --force origin main" },
      { toolCallId: "tc-1" }
    );

    expect(needed).toBe(true);
    expect(assessed).toEqual(["git push --force origin main"]);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      toolName: "run_command",
      toolCallId: "tc-1",
      aiCallId: "call-1",
    });
    expect(String(created[0]?.summary)).toContain("operator approval");
    expect(String(created[0]?.summary)).not.toMatch(/jev|typesafe/i);
  });

  it("should not gate an ordinary command", async () => {
    const { wrapped, created } = setup(false);

    const needed = await wrapped.needsApproval?.(
      { command: "pnpm test" },
      { toolCallId: "tc-2" }
    );

    expect(needed).toBe(false);
    expect(created).toHaveLength(0);
  });

  it("should run the command and resolve the approval once the operator approved", async () => {
    const { wrapped, resolved, executed } = setup(true);

    const result = await wrapped.execute(
      { command: "git push --force origin main" },
      { toolCallId: "tc-1" }
    );

    expect(result).toEqual({ exitCode: 0 });
    expect(executed).toHaveLength(1);
    expect(resolved).toEqual(["tc-1"]);
  });

  it("should leave plan mode's hard denial in charge and skip the assessment", async () => {
    const { wrapped, assessed, executed } = setup(true, {
      ...ctx,
      controlMode: "plan",
    });

    const needed = await wrapped.needsApproval?.(
      { command: "git push --force origin main" },
      { toolCallId: "tc-3" }
    );
    const result = (await wrapped.execute({
      command: "git push --force origin main",
    })) as { status: string };

    expect(needed).toBe(false);
    expect(assessed).toHaveLength(0);
    expect(result.status).toBe("policy_denied");
    expect(executed).toHaveLength(0);
  });
});
