import assert from "node:assert/strict";
import test from "node:test";
import { tool } from "ai";
import { z } from "zod";
import { gateConnectionTools } from "../../lib/agents/orchestrator/connection-approval";
import { buildConnectionsBlock } from "../../lib/agents/system-prompt";
import {
  getApprovalModeActionLabel,
  nextApprovalMode,
} from "../../lib/connections/approval";
import {
  ConnectionValidationError,
  normalizeConnectionSettingsPatch,
} from "../../lib/connections/validation";
import type { Connection } from "../../lib/types";
import type { Tool } from "ai";

function makeTriggerConnection(overrides: Partial<Connection> = {}) {
  return {
    id: "conn-trigger",
    name: "Trigger.dev",
    type: "mcp_server",
    auth_type: "bearer",
    mcp_transport: "stdio",
    mcp_url: null,
    description: "Tasks and runs",
    approval_mode: "ask",
    source_preset: "trigger",
    ...overrides,
  } as Connection;
}

test("should withhold an ask connection's tools, without reading its credential, on a surface that cannot ask", async () => {
  const { buildDynamicConnectionTools } =
    await import("../../lib/agents/tools/connections");
  let credentialReads = 0;

  const built = await buildDynamicConnectionTools(
    [makeTriggerConnection()],
    {},
    {
      getCredentials: async () => {
        credentialReads += 1;
        return "tr_pat_abc";
      },
    }
  );

  assert.equal(credentialReads, 0);
  assert.deepEqual(built.dynamicTools, {});
  assert.deepEqual(
    built.withheldConnections.map((conn) => conn.id),
    ["conn-trigger"]
  );
});

test("should load an ask connection's tools and name every one of them when the surface can ask", async () => {
  const { buildDynamicConnectionTools } =
    await import("../../lib/agents/tools/connections");

  const built = await buildDynamicConnectionTools(
    [makeTriggerConnection()],
    { canAskApproval: true },
    { getCredentials: async () => "tr_pat_abc" }
  );

  const toolNames = Object.keys(built.dynamicTools);
  assert.ok(toolNames.includes("trigger_dev_trigger_task"));
  assert.deepEqual([...built.askToolNames].sort(), [...toolNames].sort());
  assert.deepEqual(built.withheldConnections, []);
});

test("should leave an auto connection's tools out of the ask set on every surface", async () => {
  const { buildDynamicConnectionTools } =
    await import("../../lib/agents/tools/connections");
  const auto = makeTriggerConnection({ approval_mode: "auto" });

  for (const canAskApproval of [false, true]) {
    const built = await buildDynamicConnectionTools(
      [auto],
      { canAskApproval },
      { getCredentials: async () => "tr_pat_abc" }
    );
    assert.ok("trigger_dev_list_runs" in built.dynamicTools);
    assert.deepEqual([...built.askToolNames], []);
  }
});

function recordingTool(calls: unknown[]): Tool {
  return tool({
    description: "Trigger a task",
    inputSchema: z.object({ taskId: z.string() }),
    execute: async (input) => {
      calls.push(input);
      return "ran";
    },
  }) as unknown as Tool;
}

type GatedTool = {
  description?: string;
  needsApproval?: (
    input: unknown,
    options: { toolCallId: string }
  ) => Promise<boolean>;
  execute: (
    input: unknown,
    options: { toolCallId?: string }
  ) => Promise<unknown>;
};

test("should require approval, record it, and mark it approved once the gated tool runs", async () => {
  const executed: unknown[] = [];
  const created: Array<Record<string, unknown>> = [];
  const resolved: string[] = [];

  const gated = gateConnectionTools(
    { trigger_dev_trigger_task: recordingTool(executed) },
    new Set(["trigger_dev_trigger_task"]),
    { userId: "user-1", missionId: "mission-1", aiCallId: "call-1" },
    {
      createApproval: async (input) => {
        created.push(input as unknown as Record<string, unknown>);
        return { id: "approval-1" } as never;
      },
      resolveApprovalByToolCall: async ({ toolCallId }) => {
        resolved.push(toolCallId);
      },
    }
  ).trigger_dev_trigger_task as unknown as GatedTool;

  const needsApproval = await gated.needsApproval?.(
    { taskId: "sync" },
    { toolCallId: "tc-1" }
  );
  const result = await gated.execute(
    { taskId: "sync" },
    { toolCallId: "tc-1" }
  );

  assert.equal(needsApproval, true);
  assert.equal(gated.description, "Trigger a task");
  assert.equal(created.length, 1);
  assert.equal(created[0].toolName, "trigger_dev_trigger_task");
  assert.equal(created[0].toolCallId, "tc-1");
  assert.equal(created[0].runId, "mission-1");
  assert.deepEqual(created[0].toolInput, { taskId: "sync" });
  assert.deepEqual(resolved, ["tc-1"]);
  assert.deepEqual(executed, [{ taskId: "sync" }]);
  assert.equal(result, "ran");
});

test("should still require approval when the audit row cannot be written", async () => {
  const gated = gateConnectionTools(
    { api_stripe: recordingTool([]) },
    new Set(["api_stripe"]),
    { userId: "user-1" },
    {
      createApproval: async () => {
        throw new Error("database unavailable");
      },
      resolveApprovalByToolCall: async () => undefined,
    }
  ).api_stripe as unknown as GatedTool;
  const originalWarn = console.warn;
  console.warn = () => undefined;

  const needsApproval = await gated.needsApproval?.({}, { toolCallId: "tc-2" });
  console.warn = originalWarn;

  assert.equal(needsApproval, true);
});

test("should return tools outside the ask set untouched", () => {
  const original = recordingTool([]);

  const gated = gateConnectionTools(
    { linear_list_issues: original },
    new Set(["trigger_dev_trigger_task"]),
    { userId: "user-1" }
  );

  assert.equal(gated.linear_list_issues, original);
});

test("should tell the model an ask connection is not loaded on a surface that cannot ask", () => {
  const block = buildConnectionsBlock([makeTriggerConnection()]);

  assert.match(block, /Trigger\.dev: not loaded/);
  assert.match(block, /use it from Control/);
  assert.doesNotMatch(block, /trigger_dev_\*/);
});

test("should tell the model each call pauses for approval on a surface that can ask", () => {
  const block = buildConnectionsBlock([makeTriggerConnection()], {
    canAskApproval: true,
  });

  assert.match(block, /trigger_dev_\*/);
  assert.match(block, /pauses for the user's approval/);
});

test("should describe an auto connection the same way on every surface", () => {
  const auto = [makeTriggerConnection({ approval_mode: "auto" })];

  const chat = buildConnectionsBlock(auto);
  const control = buildConnectionsBlock(auto, { canAskApproval: true });

  assert.equal(chat, control);
  assert.doesNotMatch(chat, /approval/);
});

test("should accept either connection setting and reject anything else", () => {
  assert.deepEqual(normalizeConnectionSettingsPatch({ is_enabled: false }), {
    is_enabled: false,
  });
  assert.deepEqual(
    normalizeConnectionSettingsPatch({ id: "c1", approval_mode: "ask" }),
    { approval_mode: "ask" }
  );
  for (const bad of [
    {},
    { approval_mode: "always" },
    { is_enabled: "yes" },
    null,
  ]) {
    assert.throws(
      () => normalizeConnectionSettingsPatch(bad),
      ConnectionValidationError
    );
  }
});

test("should offer the opposite approval mode as the row action", () => {
  assert.equal(nextApprovalMode("auto"), "ask");
  assert.equal(nextApprovalMode("ask"), "auto");
  assert.equal(getApprovalModeActionLabel("auto"), "Ask before running tools");
  assert.equal(getApprovalModeActionLabel("ask"), "Run tools without asking");
});
