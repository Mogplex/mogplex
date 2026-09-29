import assert from "node:assert/strict";
import test from "node:test";

import { handleMogplexMcpPayload } from "../../lib/mogplex-api/mcp";
import { MogplexApiClientError } from "../../lib/mogplex-api/client-error";
import { normalizeStartRequest } from "../../lib/mogplex-api/runs-normalize";
import { MogplexApiRunError } from "../../lib/mogplex-api/runs-types";
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

test("Mogplex MCP start tool surfaces the API's refusal of a mode for the Mogplex harness", async () => {
  const response = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "start-native-mode",
      method: "tools/call",
      params: {
        name: "mogplex_start_agent_run",
        arguments: {
          repoId: "repo-1",
          prompt: "Explain the auth flow",
          harness: "mogplex",
          mode: "SAFE",
        },
      },
    },
    {
      client: buildFakeMcpClient({
        // What the API does with the forwarded body, reported the way the
        // HTTP client reports a 400.
        startAgentRun: async ({ idempotencyKey, ...body }) => {
          try {
            normalizeStartRequest({
              body,
              repo: {
                id: "repo-1",
                full_name: "example/app",
                default_branch: "main",
                root_directory: null,
              },
              idempotencyKey,
            });
          } catch (error) {
            if (error instanceof MogplexApiRunError) {
              throw new MogplexApiClientError(
                error.code,
                error.message,
                error.status
              );
            }
            throw error;
          }
          return { ...buildRun(), replayed: false };
        },
      }),
    }
  );

  const result = (
    assertSingleMcpResponse(response) as {
      result: {
        isError: boolean;
        structuredContent: { error: { code: string; status: number } };
        content: Array<{ text: string }>;
      };
    }
  ).result;
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, "BAD_REQUEST");
  assert.equal(result.structuredContent.error.status, 400);
  assert.match(result.content[0].text, /CLI execution modes/);
});
