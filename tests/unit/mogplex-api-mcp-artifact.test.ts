import assert from "node:assert/strict";
import test from "node:test";

import { MogplexApiClientError } from "../../lib/mogplex-api/client";
import { handleMogplexMcpPayload } from "../../lib/mogplex-api/mcp";

import {
  assertSingleMcpResponse,
  buildFakeMcpClient,
} from "./helpers/mogplex-api-mcp-fixtures";

test("Mogplex MCP get_run_artifact returns pinned artifact with commit label", async () => {
  const response = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "artifact-1",
      method: "tools/call",
      params: {
        name: "mogplex_get_run_artifact",
        arguments: {
          runId: "run-1",
          path: ".mogplex/artifacts/results.json",
        },
      },
    },
    {
      client: buildFakeMcpClient({
        getRunArtifact: async () => ({
          artifact: {
            runId: "run-1",
            repoId: "repo-1",
            branch: "mogplex/external/run-1",
            path: ".mogplex/artifacts/results.json",
            commitSha: "abc123def456abc123def456abc123def456abc1",
            pinned: true,
            content: { score: 95, tests: ["a", "b"] },
          },
        }),
      }),
    }
  );

  const result = (
    assertSingleMcpResponse(response) as {
      result: {
        structuredContent: {
          artifact: {
            runId: string;
            commitSha: string;
            pinned: boolean;
            content: { score: number };
          };
        };
      };
    }
  ).result;
  assert.equal(result.structuredContent.artifact.runId, "run-1");
  assert.equal(
    result.structuredContent.artifact.commitSha,
    "abc123def456abc123def456abc123def456abc1"
  );
  assert.equal(result.structuredContent.artifact.pinned, true);
  assert.equal(result.structuredContent.artifact.content.score, 95);
});

test("Mogplex MCP get_run_artifact returns unpinned artifact with branch-tip label", async () => {
  const response = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "artifact-2",
      method: "tools/call",
      params: {
        name: "mogplex_get_run_artifact",
        arguments: {
          runId: "run-old",
          path: ".mogplex/artifacts/output.json",
        },
      },
    },
    {
      client: buildFakeMcpClient({
        getRunArtifact: async () => ({
          artifact: {
            runId: "run-old",
            repoId: "repo-1",
            branch: "mogplex/external/run-old",
            path: ".mogplex/artifacts/output.json",
            commitSha: "def456abc123def456abc123def456abc123def4",
            pinned: false, // Not pinned - older run without recorded terminal commit
            content: { result: "ok" },
          },
        }),
      }),
    }
  );

  const result = (
    assertSingleMcpResponse(response) as {
      result: {
        structuredContent: {
          artifact: {
            runId: string;
            pinned: boolean;
            content: { result: string };
          };
        };
      };
    }
  ).result;
  assert.equal(result.structuredContent.artifact.runId, "run-old");
  assert.equal(result.structuredContent.artifact.pinned, false);
  assert.equal(result.structuredContent.artifact.content.result, "ok");
});

test("Mogplex MCP get_run_artifact propagates errors with proper structure", async () => {
  const response = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "artifact-error",
      method: "tools/call",
      params: {
        name: "mogplex_get_run_artifact",
        arguments: {
          runId: "missing",
          path: ".mogplex/artifacts/results.json",
        },
      },
    },
    {
      client: buildFakeMcpClient({
        getRunArtifact: async () => {
          throw new MogplexApiClientError("NOT_FOUND", "Run not found", 404);
        },
      }),
    }
  );

  const result = (
    assertSingleMcpResponse(response) as {
      result: {
        isError: boolean;
        structuredContent: { error: { code: string; message: string } };
      };
    }
  ).result;
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, "NOT_FOUND");
  assert.equal(result.structuredContent.error.message, "Run not found");
});
