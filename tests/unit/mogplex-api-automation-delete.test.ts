import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { FlowServiceError } from "../../lib/flows/errors";
import { MogplexApiClient } from "../../lib/mogplex-api/client";
import { callMogplexTool } from "../../lib/mogplex-api/mcp-handlers";
import type { Flow } from "../../lib/types";

const automationId = "11111111-1111-4111-8111-111111111111";

function configureEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
}

type Scenario = {
  scopes?: string[];
  authenticated?: boolean;
  ownerId?: string;
  inFlightRunIds?: string[];
  deleteError?: Error;
};

/** The MCP tool over the real client, DELETE route and service; storage is injected. */
async function deleteThroughMcp(scenario: Scenario = {}) {
  configureEnv();
  const { createMogplexApiAutomationDeleteHandler } =
    await import("../../app/api/v1/mogplex/automations/[automationId]/route");
  const { deleteMogplexApiAutomation } =
    await import("../../lib/mogplex-api/automation-delete");
  const deleted: Array<{ userId: string; flowId: string }> = [];
  const requests: Array<{ method?: string; pathname: string }> = [];

  const handler = createMogplexApiAutomationDeleteHandler({
    resolveApiKey: async () =>
      scenario.authenticated === false
        ? { ok: false, reason: "invalid" }
        : {
            ok: true,
            auth: {
              userId: "owner",
              keyId: "test",
              scopes: scenario.scopes ?? ["read", "write"],
            },
          },
    deleteAutomation: (userId, id) =>
      deleteMogplexApiAutomation(userId, id, {
        loadOwnedFlow: async (loadUserId, flowId) =>
          loadUserId === (scenario.ownerId ?? "owner")
            ? ({ id: flowId, name: "Classify probe" } as Flow)
            : null,
        listInFlightRunIds: async () => scenario.inFlightRunIds ?? [],
        deleteFlow: async (deleteUserId, flowId) => {
          if (scenario.deleteError) throw scenario.deleteError;
          deleted.push({ userId: deleteUserId, flowId });
          return { ok: true as const };
        },
      }),
  });
  const client = new MogplexApiClient({
    baseUrl: "https://mogplex.test",
    authorization: "mog_test",
    fetch: async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      requests.push({ method: init?.method, pathname });
      return handler(
        new NextRequest(String(url), {
          ...init,
          signal: init?.signal ?? undefined,
        }),
        {
          params: Promise.resolve({
            automationId: pathname.split("/").at(-1)!,
          }),
        }
      );
    },
  });
  const result = await callMogplexTool(
    "mogplex_delete_automation",
    { automationId },
    { client }
  );
  return { result, deleted, requests };
}

function errorOf(result: { structuredContent?: Record<string, unknown> }) {
  return result.structuredContent?.error as
    | { code: string; status: number; message: string }
    | undefined;
}

test("MCP deletes an owned automation through the v1 DELETE endpoint", async () => {
  const { result, deleted, requests } = await deleteThroughMcp();

  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent, {
    deleted: true,
    automationId,
    name: "Classify probe",
  });
  assert.equal(
    result.content[0]?.text,
    `Deleted Mogplex automation ${automationId} (Classify probe). This cannot be undone.`
  );
  assert.deepEqual(deleted, [{ userId: "owner", flowId: automationId }]);
  assert.deepEqual(requests, [
    {
      method: "DELETE",
      pathname: `/api/v1/mogplex/automations/${automationId}`,
    },
  ]);
});

test("MCP delete rejects unauthenticated, read-only and foreign callers without deleting", async () => {
  const unauthenticated = await deleteThroughMcp({ authenticated: false });
  assert.equal(errorOf(unauthenticated.result)?.status, 401);
  assert.deepEqual(unauthenticated.deleted, []);

  const readOnly = await deleteThroughMcp({ scopes: ["read"] });
  assert.equal(errorOf(readOnly.result)?.status, 403);
  assert.match(errorOf(readOnly.result)?.message ?? "", /scope: write/);
  assert.deepEqual(readOnly.deleted, []);

  const foreign = await deleteThroughMcp({ ownerId: "someone-else" });
  assert.equal(errorOf(foreign.result)?.code, "NOT_FOUND");
  assert.equal(errorOf(foreign.result)?.message, "Automation not found");
  assert.deepEqual(foreign.deleted, []);
});

test("MCP delete refuses an automation with in-flight runs and names them", async () => {
  const one = await deleteThroughMcp({ inFlightRunIds: ["run-a"] });
  assert.equal(one.result.isError, true);
  assert.equal(errorOf(one.result)?.code, "CONFLICT");
  assert.equal(errorOf(one.result)?.status, 409);
  assert.equal(
    errorOf(one.result)?.message,
    "1 run is still in flight (run-a). Cancel every in-flight run, then delete the automation."
  );
  assert.deepEqual(one.deleted, []);

  const runIds = Array.from({ length: 12 }, (_value, index) => `run-${index}`);
  const many = await deleteThroughMcp({ inFlightRunIds: runIds });
  assert.equal(
    errorOf(many.result)?.message,
    `12 runs are still in flight (${runIds.slice(0, 10).join(", ")}, and 2 more). Cancel every in-flight run, then delete the automation.`
  );
  assert.deepEqual(many.deleted, []);

  const ten = await deleteThroughMcp({ inFlightRunIds: runIds.slice(0, 10) });
  assert.doesNotMatch(errorOf(ten.result)?.message ?? "", /more\)/);
});

test("MCP delete reports a schedule cleanup failure without internal detail", async () => {
  const { result, deleted } = await deleteThroughMcp({
    deleteError: new FlowServiceError(
      "FLOW_DELETE_SYNC_FAILED",
      "Failed to delete the workflow schedule. upstream said tr_secret"
    ),
  });

  assert.equal(result.isError, true);
  assert.ok((errorOf(result)?.status ?? 0) >= 500);
  assert.equal(errorOf(result)?.message, "Failed to delete automation");
  assert.deepEqual(deleted, []);
});
