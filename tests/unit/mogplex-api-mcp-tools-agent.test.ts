import assert from "node:assert/strict";
import test from "node:test";

import { handleMogplexMcpPayload } from "../../lib/mogplex-api/mcp";
import type { MogplexApiRunDetail } from "../../lib/mogplex-api/runs";

import {
  assertSingleMcpResponse,
  buildFakeMcpClient,
  buildRun,
} from "./helpers/mogplex-api-mcp-fixtures";

test("Mogplex MCP start tool forwards the roster agent id to the run", async () => {
  let seenAgentId: string | undefined;
  const response = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "start-agent",
      method: "tools/call",
      params: {
        name: "mogplex_start_agent_run",
        arguments: {
          repoId: "repo-1",
          prompt: "Audit the auth routes",
          agentId: "preset:SECURITY-SCAN",
        },
      },
    },
    {
      client: buildFakeMcpClient({
        startAgentRun: async (input) => {
          seenAgentId = input.agentId as string | undefined;
          return {
            ...buildRun({ agentId: "preset:SECURITY-SCAN" }),
            replayed: false,
          };
        },
      }),
    }
  );
  assert.equal(seenAgentId, "preset:SECURITY-SCAN");
  const result = (
    assertSingleMcpResponse(response) as {
      result: { structuredContent: { run: MogplexApiRunDetail } };
    }
  ).result;
  assert.equal(result.structuredContent.run.agentId, "preset:SECURITY-SCAN");
});

test("Mogplex MCP start tool forwards the run mode and rejects unknown modes", async () => {
  const seenModes: unknown[] = [];
  const start = (mode: string) =>
    handleMogplexMcpPayload(
      {
        jsonrpc: "2.0",
        id: `start-${mode}`,
        method: "tools/call",
        params: {
          name: "mogplex_start_agent_run",
          arguments: {
            repoId: "repo-1",
            prompt: "Explain the auth flow",
            harness: "claude-code",
            mode,
          },
        },
      },
      {
        client: buildFakeMcpClient({
          startAgentRun: async (input) => {
            seenModes.push(input.mode);
            return { ...buildRun(), replayed: false };
          },
        }),
      }
    );

  await start("SAFE");
  assert.deepEqual(seenModes, ["SAFE"]);

  const rejected = assertSingleMcpResponse(await start("risky")) as {
    error?: { message: string };
    result?: { isError: boolean; content: Array<{ text: string }> };
  };
  const message =
    rejected.error?.message ?? rejected.result?.content[0]?.text ?? "";
  assert.ok(rejected.error || rejected.result?.isError, "risky is refused");
  assert.match(message, /mode/);
  assert.deepEqual(seenModes, ["SAFE"], "an unknown mode never starts a run");
});
