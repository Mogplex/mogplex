import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  buildFakeMcpClient,
  loadMcpRoute,
} from "./helpers/mogplex-api-mcp-fixtures";

test("draft-test tool reaches the saved-draft API and tells the caller to inspect completion", async () => {
  await loadMcpRoute();
  const { callMogplexTool } =
    await import("../../lib/mogplex-api/mcp-handlers");
  const calls: unknown[] = [];
  const client = buildFakeMcpClient({
    testAutomation: async (input) => {
      calls.push(input);
      return {
        run: {
          automationId: input.automationId,
          jobRunId: "draft-job",
          outcome: "queued",
          reason: null,
          started: false,
          status: "pending",
          runtime: null,
        },
      };
    },
  });
  const result = await callMogplexTool(
    "mogplex_test_automation",
    {
      automationId: "flow",
      repoId: "repo",
      input: { pr_number: 12 },
      idempotencyKey: "test-once",
    },
    { client }
  );
  assert.deepEqual(calls, [
    {
      automationId: "flow",
      repoId: "repo",
      input: { pr_number: 12 },
      idempotencyKey: "test-once",
    },
  ]);
  assert.match(JSON.stringify(result.content), /Inspect logs for completion/);
});

test("draft-test endpoint refuses missing auth, read-only keys, restricted team keys and invalid input", async () => {
  await loadMcpRoute();
  const { createAutomationTestHandler } =
    await import("../../app/api/v1/mogplex/automations/[automationId]/test/route");
  const params = { params: Promise.resolve({ automationId: "flow" }) };
  const request = (body: unknown, authorized = true) =>
    new NextRequest(
      "https://mogplex.test/api/v1/mogplex/automations/flow/test",
      {
        method: "POST",
        headers: {
          ...(authorized ? { authorization: "Bearer mog_fixture" } : {}),
          "idempotency-key": "test",
        },
        body: JSON.stringify(body),
      }
    );
  const auth =
    (scopes = ["read", "write"]) =>
    async () => ({
      ok: true as const,
      auth: { userId: "owner", keyId: "key", scopes },
    });
  assert.equal(
    (await createAutomationTestHandler()(request({}, false), params)).status,
    401
  );
  assert.equal(
    (
      await createAutomationTestHandler({ resolveApiKey: auth(["read"]) })(
        request({ repoId: "repo" }),
        params
      )
    ).status,
    403
  );
  assert.equal(
    (
      await createAutomationTestHandler({ resolveApiKey: auth() })(
        request({ repoId: "repo", input: [] }),
        params
      )
    ).status,
    400
  );
  const denied = createAutomationTestHandler({
    resolveApiKey: auth(),
    loadTeamKeyAccess: async (_user, target) =>
      "repoId" in target ? "automations" : "full",
  });
  assert.equal((await denied(request({ repoId: "repo" }), params)).status, 403);
});
