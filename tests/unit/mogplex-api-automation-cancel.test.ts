import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { MogplexApiClient } from "../../lib/mogplex-api/client";
import { callMogplexTool } from "../../lib/mogplex-api/mcp-handlers";
import {
  withPatchedCancellationStore,
  type JobRunRow,
} from "./helpers/job-run-cancel-fixtures";

const flowId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const otherFlowId = "33333333-3333-4333-8333-333333333333";
const args = { automationId: flowId, runId };

function buildJob(status: JobRunRow["status"] = "running"): JobRunRow {
  return {
    id: runId,
    status,
    assignment_id: null,
    trigger_id: null,
    flow_id: flowId,
    flow_version_id: null,
    retry_of_job_run_id: null,
    runtime_provider: "trigger",
    runtime_run_id: "run_fixture",
    workflow_run_id: null,
    created_at: "2026-09-17T00:00:00Z",
    started_at: "2026-09-17T00:00:00Z",
    completed_at: null,
    duration_ms: null,
    error: null,
    cancel_requested_at: null,
    cancelled_at: null,
    cancel_reason: null,
    cancel_error: null,
    metadata: {},
  };
}

async function clientFor(
  userId = "owner",
  scopes = ["read", "write"],
  authenticated = true
) {
  const { createMogplexApiAutomationRunCancelHandler } =
    await import("../../app/api/v1/mogplex/automations/[automationId]/runs/[runId]/cancel/route");
  const handler = createMogplexApiAutomationRunCancelHandler({
    resolveApiKey: async () =>
      authenticated
        ? { ok: true, auth: { userId, keyId: "test", scopes } }
        : { ok: false, reason: "invalid" },
  });
  return new MogplexApiClient({
    baseUrl: "https://mogplex.test",
    authorization: "mog_test",
    fetch: async (url, init) => {
      const parts = new URL(String(url)).pathname.split("/");
      assert.equal(init?.method, "POST");
      assert.equal(parts.at(-1), "cancel");
      assert.equal(parts.at(-3), "runs");
      return handler(
        new NextRequest(String(url), {
          ...init,
          signal: init?.signal ?? undefined,
        }),
        {
          params: Promise.resolve({
            automationId: parts.at(-4)!,
            runId: parts.at(-2)!,
          }),
        }
      );
    },
  });
}

test("MCP cancels a flow runtime and pending waits through the real API and service", async () => {
  const runtimes: string[] = [];
  await withPatchedCancellationStore(
    {
      jobRuns: [buildJob()],
      flows: [{ id: flowId, user_id: "owner" }],
      flowWaits: [
        {
          id: "wait",
          job_run_id: runId,
          status: "waiting",
          resume_payload: null,
        },
      ],
      cancelImpl: async (id) => {
        runtimes.push(id);
      },
    },
    async ({ jobRuns, flowWaits, dispatchEvents }) => {
      const result = await callMogplexTool(
        "mogplex_cancel_automation_run",
        args,
        { client: await clientFor() }
      );
      assert.equal(result.isError, false);
      assert.equal(result.structuredContent?.status, "cancelled");
      assert.equal(jobRuns[0].status, "cancelled");
      assert.equal(flowWaits[0].status, "cancelled");
      assert.deepEqual(runtimes, ["run_fixture"]);
      assert.deepEqual(
        dispatchEvents.map((event) => event.outcome),
        ["cancel_requested", "cancelled"]
      );
    }
  );
});

test("MCP cancellation rejects unauthenticated, read-only, foreign, mismatched and completed runs", async () => {
  let runtimeCalls = 0;
  await withPatchedCancellationStore(
    {
      jobRuns: [buildJob("success")],
      flows: [
        { id: flowId, user_id: "owner" },
        { id: otherFlowId, user_id: "owner" },
      ],
      cancelImpl: async () => {
        runtimeCalls++;
      },
    },
    async ({ jobRuns }) => {
      for (const [client, input, code] of [
        [
          await clientFor("owner", ["read", "write"], false),
          args,
          "UNAUTHORIZED",
        ],
        [await clientFor("owner", ["read"]), args, "FORBIDDEN"],
        [await clientFor("other"), args, "NOT_FOUND"],
        [
          await clientFor(),
          { ...args, automationId: otherFlowId },
          "NOT_FOUND",
        ],
        [await clientFor(), args, "CONFLICT"],
      ] as const) {
        const result = await callMogplexTool(
          "mogplex_cancel_automation_run",
          input,
          { client }
        );
        assert.equal(result.isError, true);
        assert.equal(
          (result.structuredContent?.error as { code: string }).code,
          code
        );
      }
      const client = await clientFor();
      await assert.rejects(
        () => client.cancelAutomationRun({ automationId: "not-a-uuid", runId }),
        { code: "BAD_REQUEST", status: 400 }
      );
      await assert.rejects(
        () =>
          callMogplexTool(
            "mogplex_cancel_automation_run",
            { automationId: flowId },
            { client }
          ),
        /runId/
      );
      assert.equal(runtimeCalls, 0);
      assert.equal(jobRuns[0].cancel_requested_at, null);
    }
  );
});

test("MCP reports runtime cancellation failure without claiming the job stopped", async () => {
  await withPatchedCancellationStore(
    {
      jobRuns: [buildJob()],
      flows: [{ id: flowId, user_id: "owner" }],
      cancelImpl: async () => {
        throw new Error("provider unavailable");
      },
    },
    async ({ jobRuns }) => {
      const result = await callMogplexTool(
        "mogplex_cancel_automation_run",
        args,
        { client: await clientFor() }
      );
      assert.equal(result.isError, true);
      assert.equal(
        (result.structuredContent?.error as { code: string }).code,
        "INTERNAL_ERROR"
      );
      assert.equal(jobRuns[0].status, "running");
      assert.equal(jobRuns[0].cancel_error, "provider unavailable");
      assert.equal(jobRuns[0].cancelled_at, null);
    }
  );
});
