import assert from "node:assert/strict";
import test from "node:test";
import { buildLoadedSandboxDetailRecord } from "./sandbox-record-route-test-harness/record-builders";
import {
  buildResolvedSandboxRouteContext,
  buildSandboxRouteContextFailure,
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
  loadSandboxRecordRouteModule,
} from "./sandbox-record-route-test-harness";

test("GET /api/sandbox/[id] falls back to a normalized sandbox payload on transient client resolution errors", async () => {
  const { createSandboxDetailGetHandler } =
    await loadSandboxRecordRouteModule();

  const handler = createSandboxDetailGetHandler({
    loadOwnedSandboxRouteRecord: async () =>
      buildLoadedSandboxDetailRecord({
        billing_source: null,
        billing_team_id: null,
        billing_project_id: null,
      }) as never,
    resolveLoadedSandboxRouteContext: async () =>
      buildSandboxRouteContextFailure({
        status: 500,
        error: "Failed to load sandbox client",
      }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest(),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.sandbox.runtime_summary.status, "running");
  assert.equal(payload.sandbox.billing_summary.label, "Mogplex billing");
  assert.equal("status" in payload.sandbox, false);
  assert.equal("preview_url" in payload.sandbox, false);
  assert.equal("health_status" in payload.sandbox, false);
});

test("GET /api/sandbox/[id] preserves normalized summaries after live status reconciliation", async () => {
  const { createSandboxDetailGetHandler } =
    await loadSandboxRecordRouteModule();
  const stoppedIds: string[] = [];

  const handler = createSandboxDetailGetHandler({
    loadOwnedSandboxRouteRecord: async () =>
      buildLoadedSandboxDetailRecord({
        preview_url: null,
        billing_source: "user_vercel_project",
        billing_team_id: "team-acme",
        billing_project_id: "project-acme",
        vercel_team_id: "team-acme",
        vercel_project_id: "project-acme",
      }) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded, {
        sandbox: { status: "stopped" },
      }) as never,
    stopSandboxRecord: async (id) => {
      stoppedIds.push(id);
      return { id } as never;
    },
  });

  const response = await handler(
    buildSandboxRouteRequest(),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(stoppedIds, ["sandbox-1"]);
  assert.equal(payload.sandbox.runtime_summary.status, "stopped");
  assert.equal(payload.sandbox.runtime_summary.health_status, "stopped");
  assert.equal(payload.sandbox.billing_summary.label, "Your Vercel project");
  assert.equal("status" in payload.sandbox, false);
});

test("GET /api/sandbox/[id] preserves persistent paused records when the VM is stopped", async () => {
  const { createSandboxDetailGetHandler } =
    await loadSandboxRecordRouteModule();
  const stoppedIds: string[] = [];
  const pausedRecord = {
    status: "paused",
    health_status: "paused",
    snapshot_id: null,
    persistent: true,
  };

  const handler = createSandboxDetailGetHandler({
    loadOwnedSandboxRouteRecord: async () =>
      buildLoadedSandboxDetailRecord(pausedRecord) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded, {
        sandbox: { status: "stopped" },
      }) as never,
    stopSandboxRecord: async (id) => {
      stoppedIds.push(id);
      return { id } as never;
    },
  });

  const response = await handler(
    buildSandboxRouteRequest(),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(stoppedIds, []);
  assert.equal(payload.sandbox.runtime_summary.status, "paused");
  assert.equal(payload.sandbox.runtime_summary.health_status, "paused");
  assert.equal(payload.sandbox.runtime_summary.persistent, true);
  assert.equal(payload.sandbox.snapshot_id, null);
});

test("GET /api/sandbox/[id] normalizes stopped health_status in the response shape", async () => {
  const { createSandboxDetailGetHandler } =
    await loadSandboxRecordRouteModule();
  const updateCalls: Array<Record<string, unknown>> = [];
  const scheduledTasks: Array<() => unknown | Promise<unknown>> = [];

  const handler = createSandboxDetailGetHandler({
    loadOwnedSandboxRouteRecord: async () =>
      buildLoadedSandboxDetailRecord({
        status: "stopped",
        preview_url: null,
        health_status: "app_error",
        error: "Sandbox was previously unhealthy",
        last_preview_error: "App crashed",
      }) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded, {
        sandbox: { status: "stopped" },
      }) as never,
    updateSandboxRecord: async (_id, updates, options) => {
      updateCalls.push({
        updates,
        expectedSandboxId: options?.expectedSandboxId,
        expectedHealthStatus: options?.expectedHealthStatus,
        fromStatuses: options?.fromStatuses,
      });
      return { id: "sandbox-1" } as never;
    },
    scheduleAfter: (task) => {
      if (typeof task === "function") {
        scheduledTasks.push(task as () => unknown | Promise<unknown>);
      }
    },
  });

  const response = await handler(
    buildSandboxRouteRequest(),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(updateCalls.length, 0);
  assert.equal(scheduledTasks.length, 1);
  assert.equal(payload.sandbox.runtime_summary.status, "stopped");
  assert.equal(payload.sandbox.runtime_summary.health_status, "stopped");
  assert.equal(
    payload.sandbox.error_summary.display_error,
    "Sandbox was previously unhealthy"
  );

  await scheduledTasks[0]?.();

  assert.deepEqual(updateCalls, [
    {
      updates: { health_status: "stopped" },
      expectedSandboxId: "vm_123",
      expectedHealthStatus: "app_error",
      fromStatuses: "stopped",
    },
  ]);
});

test("GET /api/sandbox/[id] tolerates persistence failures during live status reconciliation", async () => {
  const { createSandboxDetailGetHandler } =
    await loadSandboxRecordRouteModule();
  const errors: Array<Parameters<typeof console.error>> = [];
  const originalConsoleError = console.error;
  console.error = (...args: Parameters<typeof console.error>) => {
    errors.push(args);
  };

  try {
    const handler = createSandboxDetailGetHandler({
      loadOwnedSandboxRouteRecord: async () =>
        buildLoadedSandboxDetailRecord({
          preview_url: null,
        }) as never,
      resolveLoadedSandboxRouteContext: async (loaded) =>
        buildResolvedSandboxRouteContext(loaded, {
          sandbox: { status: "stopped" },
        }) as never,
      stopSandboxRecord: async () => {
        throw new Error("detail status write failed");
      },
    });

    const response = await handler(
      buildSandboxRouteRequest(),
      buildSandboxRouteParams()
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.sandbox.runtime_summary.status, "stopped");
    assert.equal(payload.sandbox.runtime_summary.health_status, "stopped");
    assert.equal("status" in payload.sandbox, false);
    assert.equal(errors.length, 1);
    assert.match(
      String(errors[0]?.[0]),
      /Failed to persist live status reconciliation/
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("GET /api/sandbox/[id] logs stopped health_status repair failures", async () => {
  const { createSandboxDetailGetHandler } =
    await loadSandboxRecordRouteModule();
  const errors: Array<Parameters<typeof console.error>> = [];
  const scheduledTasks: Array<() => unknown | Promise<unknown>> = [];
  const originalConsoleError = console.error;
  console.error = (...args: Parameters<typeof console.error>) => {
    errors.push(args);
  };

  try {
    const handler = createSandboxDetailGetHandler({
      loadOwnedSandboxRouteRecord: async () =>
        buildLoadedSandboxDetailRecord({
          status: "stopped",
          preview_url: null,
          health_status: null,
        }) as never,
      resolveLoadedSandboxRouteContext: async (loaded) =>
        buildResolvedSandboxRouteContext(loaded, {
          sandbox: { status: "stopped" },
        }) as never,
      updateSandboxRecord: async () => {
        throw new Error("background repair failed");
      },
      scheduleAfter: (task) => {
        if (typeof task === "function") {
          scheduledTasks.push(task as () => unknown | Promise<unknown>);
        }
      },
    });

    const response = await handler(
      buildSandboxRouteRequest(),
      buildSandboxRouteParams()
    );

    assert.equal(response.status, 200);
    assert.equal(scheduledTasks.length, 1);

    await scheduledTasks[0]?.();

    assert.equal(errors.length, 1);
    assert.match(
      String(errors[0]?.[0]),
      /Failed to repair stopped health status/
    );
  } finally {
    console.error = originalConsoleError;
  }
});
