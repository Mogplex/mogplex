import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLoadedSandboxHealthRouteContext,
  buildSandboxRouteContextFailure,
} from "./sandbox-record-route-test-harness";

async function loadObservabilityCallCancelRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/observability/calls/[id]/cancel/route");
}

function buildActiveAiCall() {
  return {
    id: "call-123",
    status: "streaming",
    control_state: "active",
    cancel_requested_at: null,
    started_at: "2026-03-31T12:00:00.000Z",
    conversation_id: "conv-123",
    repo_id: "repo-123",
    runtime_command_id: "cmd-123",
    metadata: {
      sandbox_record_id: "sandbox-record-123",
    },
  };
}

function buildLoadedSandboxCallCancelContext({
  sandbox,
  sandboxRuntimeId = "sandbox-runtime-123",
  projectId = "project-123",
  teamId = null,
}: {
  sandbox?: Record<string, unknown> | null;
  sandboxRuntimeId?: string;
  projectId?: string;
  teamId?: string | null;
} = {}) {
  return buildLoadedSandboxHealthRouteContext({
    auth: {
      userId: "user-123",
      vercelProjectId: projectId,
      vercelTeamId: teamId,
    },
    record: {
      id: "sandbox-record-123",
      sandbox_id: sandboxRuntimeId,
      billing_source: "platform",
      billing_team_id: teamId,
      billing_project_id: projectId,
      vercel_team_id: teamId,
      vercel_project_id: projectId,
    },
    ownership: {
      source: "record",
      billingSource: "platform",
      credentialSource: "platform",
      projectId,
      teamId,
    },
    credentials: {
      vercelProjectId: projectId,
      vercelTeamId: teamId,
    },
    sandbox,
  });
}

test("POST /api/observability/calls/[id]/cancel cancels sandbox-backed runs via the shared sandbox route loader", async () => {
  const { createObservabilityCallCancelPostHandler } =
    await loadObservabilityCallCancelRoute();
  const appendedEvents: Array<{
    eventType: string;
    message: string | null | undefined;
  }> = [];
  let killedCommandId: string | null = null;
  let loadedSandboxId: string | null = null;

  const handler = createObservabilityCallCancelPostHandler({
    requireUserId: async () => "user-123",
    loadOwnedAiCall: async () => buildActiveAiCall() as never,
    requestAiCallCancellationIfActive: async () =>
      ({
        ...buildActiveAiCall(),
        control_state: "cancel_requested",
      }) as never,
    finalizeAiCallAsCancelledIfActive: async () =>
      ({
        ...buildActiveAiCall(),
        status: "cancelled",
        control_state: "cancelled",
      }) as never,
    appendAiCallEvent: async (input) => {
      appendedEvents.push({
        eventType: input.eventType,
        message: input.message,
      });
      return {} as never;
    },
    loadOwnedSandboxRouteContext: async (_request, sandboxId) => {
      loadedSandboxId = sandboxId;
      return buildLoadedSandboxCallCancelContext({
        sandbox: {
          getCommand: async (commandId: string) => ({
            kill: async () => {
              killedCommandId = commandId;
            },
          }),
        },
      }) as never;
    },
  });

  const response = await handler(
    new Request("http://localhost/api/observability/calls/call-123/cancel", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "call-123" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "cancelled" });
  assert.equal(loadedSandboxId, "sandbox-record-123");
  assert.equal(killedCommandId, "cmd-123");
  assert.deepEqual(
    appendedEvents.map((event) => event.eventType),
    ["cancel_requested", "cancelled"]
  );
});

test("POST /api/observability/calls/[id]/cancel returns shared loader failures for sandbox-backed runs", async () => {
  const { createObservabilityCallCancelPostHandler } =
    await loadObservabilityCallCancelRoute();

  const handler = createObservabilityCallCancelPostHandler({
    requireUserId: async () => "user-123",
    loadOwnedAiCall: async () => buildActiveAiCall() as never,
    requestAiCallCancellationIfActive: async () =>
      ({
        ...buildActiveAiCall(),
        control_state: "cancel_requested",
      }) as never,
    appendAiCallEvent: async () => ({}) as never,
    loadOwnedSandboxRouteContext: async () =>
      buildSandboxRouteContextFailure({
        status: 400,
        error:
          "Sandbox is missing its stored Vercel project for user-owned billing.",
      }) as never,
  });

  const response = await handler(
    new Request("http://localhost/api/observability/calls/call-123/cancel", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "call-123" }) }
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error:
      "Sandbox is missing its stored Vercel project for user-owned billing.",
  });
});
