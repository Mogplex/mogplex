import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { tool } from "ai";
import { z } from "zod";
import {
  buildControlTurnTools,
  loadControlConnectionTools,
  type ControlConnectionToolDeps,
} from "../../app/api/control/chat/_lib/connection-tools";
import type { Connection } from "../../lib/types";
import type { Tool } from "ai";

const triggerConnection = {
  id: "conn-trigger",
  name: "Trigger.dev",
  type: "mcp_server",
  description: "Tasks, runs, deploys",
  mcp_transport: "stdio",
  mcp_url: null,
  source_preset: "trigger",
} as Connection;

function fakeTool(result: string): Tool {
  return tool({
    description: result,
    inputSchema: z.object({}),
    execute: async () => result,
  }) as unknown as Tool;
}

function makeDeps(
  overrides: Partial<ControlConnectionToolDeps> = {}
): ControlConnectionToolDeps {
  return {
    resolveCapabilities: async () => new Set(["connections.create"] as const),
    loadConnections: async () => [triggerConnection],
    buildTools: async () => ({
      dynamicTools: { trigger_dev_list_runs: fakeTool("runs") },
      mcpCleanups: [],
      mcpToolNames: new Set(["trigger_dev_list_runs"]),
      restToolNames: new Set<string>(),
    }),
    timeoutMs: 1000,
    ...overrides,
  };
}

const solo = {
  userId: "user-1",
  teamId: null,
  repoId: "repo-1",
  enabled: true,
};

test("should load the operator's connection tools for a Control turn in solo scope", async () => {
  const requested: Array<[string, string | undefined]> = [];

  const loaded = await loadControlConnectionTools(
    solo,
    makeDeps({
      resolveCapabilities: async () => {
        throw new Error("solo scope must not resolve team capabilities");
      },
      loadConnections: async (userId, repoId) => {
        requested.push([userId, repoId]);
        return [triggerConnection];
      },
    })
  );

  assert.deepEqual(requested, [["user-1", "repo-1"]]);
  assert.deepEqual(Object.keys(loaded.tools), ["trigger_dev_list_runs"]);
  assert.deepEqual(loaded.connections, [triggerConnection]);
});

test("should withhold connection tools when the team role lacks connections.create", async () => {
  // Recorded, not thrown: loading fails open, so a throw here would be
  // swallowed and the test could not tell a skipped read from a failed one.
  let connectionReads = 0;

  const loaded = await loadControlConnectionTools(
    { ...solo, teamId: "team-1" },
    makeDeps({
      resolveCapabilities: async () => new Set(["tools.skills"] as const),
      loadConnections: async () => {
        connectionReads += 1;
        return [triggerConnection];
      },
    })
  );

  assert.equal(connectionReads, 0);
  assert.deepEqual(loaded.tools, {});
  assert.deepEqual(loaded.connections, []);
});

test("should skip loading entirely when the turn has tools disabled", async () => {
  let connectionReads = 0;

  const loaded = await loadControlConnectionTools(
    { ...solo, enabled: false },
    makeDeps({
      loadConnections: async () => {
        connectionReads += 1;
        return [triggerConnection];
      },
    })
  );

  assert.equal(connectionReads, 0);
  assert.deepEqual(loaded.tools, {});
});

test("should let the turn continue without connection tools when loading throws", async () => {
  const warn = mock.method(console, "warn", () => undefined);

  const loaded = await loadControlConnectionTools(
    solo,
    makeDeps({
      buildTools: async () => {
        throw new Error("neon is down");
      },
    })
  );
  const warned = warn.mock.calls.length;
  mock.restoreAll();

  assert.deepEqual(loaded.tools, {});
  assert.equal(warned, 1);
});

test("should give up on a slow connection and close what it opens afterwards", async () => {
  const warn = mock.method(console, "warn", () => undefined);
  let closed = 0;
  let finishBuild: () => void = () => undefined;
  const built = new Promise<void>((resolve) => {
    finishBuild = resolve;
  });

  const startedAt = Date.now();
  const loaded = await loadControlConnectionTools(
    solo,
    makeDeps({
      timeoutMs: 5,
      buildTools: async () => {
        await built;
        return {
          dynamicTools: { slow_tool: fakeTool("slow") },
          mcpCleanups: [
            async () => {
              closed += 1;
            },
          ],
          mcpToolNames: new Set(["slow_tool"]),
          restToolNames: new Set<string>(),
        };
      },
    })
  );

  // The configured wait, not the production default, decided when to give up.
  assert.ok(Date.now() - startedAt < 1000);
  assert.deepEqual(loaded.tools, {});
  assert.equal(closed, 0);

  finishBuild();
  await new Promise((resolve) => setTimeout(resolve, 10));
  mock.restoreAll();

  assert.equal(closed, 1);
  assert.equal(warn.mock.calls.length, 1);
});

test("should close the MCP clients a loaded turn holds when it cleans up", async () => {
  let closed = 0;
  const loaded = await loadControlConnectionTools(
    solo,
    makeDeps({
      buildTools: async () => ({
        dynamicTools: { linear_list_issues: fakeTool("issues") },
        mcpCleanups: [
          async () => {
            closed += 1;
          },
        ],
        mcpToolNames: new Set(["linear_list_issues"]),
        restToolNames: new Set<string>(),
      }),
    })
  );

  await loaded.cleanup();

  assert.equal(closed, 1);
});

const toolContext = { userId: "user-1", teamId: null } as never;
const promptContext = { repoFullName: "acme/app" } as never;

test("should expose connection tools to the coordinator and describe them in its prompt", () => {
  const { tools, systemPrompt } = buildControlTurnTools({
    toolContext,
    promptContext,
    connectionTools: {
      tools: { trigger_dev_list_runs: fakeTool("runs") },
      connections: [triggerConnection],
      cleanup: async () => undefined,
    },
    enableTools: true,
  });

  assert.ok(tools && "trigger_dev_list_runs" in tools);
  assert.match(systemPrompt, /<connections>/);
  assert.match(systemPrompt, /trigger_dev_\*/);
});

test("should keep Control's own tool when a connection tool has the same name", async () => {
  const warn = mock.method(console, "warn", () => undefined);

  const { tools } = buildControlTurnTools({
    toolContext,
    promptContext,
    connectionTools: {
      tools: { memory_write: fakeTool("from a connection") },
      connections: [triggerConnection],
      cleanup: async () => undefined,
    },
    enableTools: true,
  });
  const warned = warn.mock.calls.length;
  mock.restoreAll();

  const description = (tools?.memory_write as { description?: string })
    .description;
  assert.notEqual(description, "from a connection");
  assert.equal(warned, 1);
});

test("should offer no tools and no connections block when the turn has tools disabled", () => {
  const { tools, systemPrompt } = buildControlTurnTools({
    toolContext,
    promptContext,
    connectionTools: {
      tools: { trigger_dev_list_runs: fakeTool("runs") },
      connections: [triggerConnection],
      cleanup: async () => undefined,
    },
    enableTools: false,
  });

  assert.equal(tools, undefined);
  assert.doesNotMatch(systemPrompt, /<connections>/);
});
