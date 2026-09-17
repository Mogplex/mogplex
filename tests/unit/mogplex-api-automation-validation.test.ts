import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createAutomationValidateHandler } from "../../app/api/v1/mogplex/automations/validate/route";
import { scheduledTaskExample } from "../../lib/mogplex-api/automation-schema";

const request = (body: unknown, token = "mog_test") =>
  new NextRequest("https://mogplex.test/api/v1/mogplex/automations/validate", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });

test("automation preflight requires authentication and read scope", async () => {
  const handler = createAutomationValidateHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: { userId: "owner", keyId: "test", scopes: [] },
    }),
  });
  assert.equal((await handler(request({}, ""))).status, 401);
  assert.equal((await handler(request({}))).status, 403);
});

test("automation preflight reports malformed fields before database access", async () => {
  const handler = createAutomationValidateHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: { userId: "owner", keyId: "test", scopes: ["read"] },
    }),
  });
  for (const [field, value] of [
    ["role", "taks"],
    ["harness", "native"],
    ["systemPromptOverride", 42],
    ["requireApproval", "false"],
  ]) {
    const graph = structuredClone(scheduledTaskExample);
    Object.assign(graph.nodes.find((node) => node.type === "agent")!.data, {
      [String(field)]: value,
    });
    const response = await handler(request({ installationId: 123, graph }));
    assert.equal(response.status, 400);
    assert.match(
      JSON.stringify(await response.json()),
      new RegExp(String(field))
    );
  }
  assert.equal(
    (
      await handler(
        request({ installationId: -1, graph: scheduledTaskExample })
      )
    ).status,
    400
  );
});
