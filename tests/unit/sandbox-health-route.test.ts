import assert from "node:assert/strict";
import test from "node:test";
import { SandboxBillingAdmissionError } from "@/lib/billing/sandbox-usage";
import { loadSandboxHealthRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildLoadedSandboxHealthRouteContext,
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
} from "./sandbox-record-route-test-harness";

test("GET /api/sandbox/[id]/health returns normalized summaries for user-billed sandboxes", async () => {
  const { createSandboxHealthGetHandler } =
    await loadSandboxHealthRouteModule();

  const handler = createSandboxHealthGetHandler({
    loadOwnedSandboxRouteContext: async () =>
      buildLoadedSandboxHealthRouteContext({
        auth: {
          vercelToken: "user-token",
          vercelTeamId: "team-acme",
          vercelProjectId: "project-acme",
          userVercelToken: "user-token",
          userVercelTeamId: "team-acme",
        },
        record: {
          billing_source: "user_vercel_project",
          billing_team_id: "team-acme",
          billing_project_id: "project-acme",
          vercel_team_id: "team-acme",
          vercel_project_id: "project-acme",
          created_at: "2026-04-01T11:57:00.000Z",
          last_active_at: "2026-04-01T12:00:00.000Z",
        },
      }) as never,
    readDevLog: async () => "dev log output",
    checkSandboxHealth: async () =>
      ({
        status: "running",
        statusCode: 200,
        message: null,
      }) as never,
    loadVercelDiagnostics: async () => ({
      state: "ready",
      deploymentId: "dpl_ready",
      deploymentUrl: "https://ready-app.vercel.app",
      deploymentStatus: "READY",
      buildSummary: null,
      detectedAt: "2026-04-01T12:05:00.000Z",
    }),
    updateSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ suffix: "/health" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.health.status, "running");
  assert.equal(payload.sandbox.runtime_summary.health_status, "running");
  assert.equal(payload.sandbox.billing_summary.label, "Your Vercel project");
  assert.equal(payload.sandbox.dev_log, "dev log output");
  assert.equal(
    payload.sandbox.runtime_summary.vercel_diagnostics.state,
    "ready"
  );
  assert.equal("status" in payload.sandbox, false);
  assert.equal("preview_url" in payload.sandbox, false);
});

test("GET /api/sandbox/[id]/health returns 402 when dev-log access resumes an unfunded sandbox", async () => {
  const { createSandboxHealthGetHandler } =
    await loadSandboxHealthRouteModule();
  const handler = createSandboxHealthGetHandler({
    loadOwnedSandboxRouteContext: async () =>
      buildLoadedSandboxHealthRouteContext() as never,
    readDevLog: async () => {
      throw new SandboxBillingAdmissionError(
        "Hosted sandbox compute requires a positive billing balance",
        "no_billing_account"
      );
    },
    checkSandboxHealth: async () =>
      ({ status: "running", statusCode: 200, message: null }) as never,
    loadVercelDiagnostics: async () => null,
    updateSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ suffix: "/health" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 402);
  assert.deepEqual(await response.json(), {
    error: "Hosted sandbox compute requires a positive billing balance",
  });
});

test("GET /api/sandbox/[id]/health renders personal billing fallback in normalized summaries", async () => {
  const { createSandboxHealthGetHandler } =
    await loadSandboxHealthRouteModule();

  const handler = createSandboxHealthGetHandler({
    loadOwnedSandboxRouteContext: async () =>
      buildLoadedSandboxHealthRouteContext({
        record: {
          id: "sandbox-2",
          repo_id: "repo-2",
          sandbox_id: "pending",
          preview_url: null,
          health_status: null,
          last_active_at: null,
          status: "creating",
          last_boot_error: "Missing lockfile",
          boot_attempts: 0,
          last_boot_started_at: null,
          last_boot_completed_at: null,
          billing_source: null,
          billing_team_id: null,
          billing_project_id: null,
          vercel_team_id: null,
          vercel_project_id: "fallback-project",
          created_at: "2026-04-01T11:57:00.000Z",
        },
      }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ id: "sandbox-2", suffix: "/health" }),
    buildSandboxRouteParams("sandbox-2")
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.sandbox.billing_summary.team_label, "Personal");
  assert.equal(payload.sandbox.runtime_summary.status, "creating");
  assert.equal(
    payload.sandbox.error_summary.last_boot_error,
    "Missing lockfile"
  );
  assert.equal("health_status" in payload.sandbox, false);
});

test("GET /api/sandbox/[id]/health injects Vercel build diagnostics into summaries", async () => {
  const { createSandboxHealthGetHandler } =
    await loadSandboxHealthRouteModule();

  const handler = createSandboxHealthGetHandler({
    loadOwnedSandboxRouteContext: async () =>
      buildLoadedSandboxHealthRouteContext({
        auth: {
          vercelTeamId: "team-acme",
          vercelProjectId: "project-acme",
        },
        record: {
          id: "sandbox-3",
          repo_id: "repo-3",
          sandbox_id: "vm_build",
          health_status: "app_error",
          last_active_at: "2026-04-01T12:00:00.000Z",
          last_preview_http_status: 503,
          last_preview_error: "Service unavailable",
          billing_source: "platform",
          billing_team_id: "team-acme",
          billing_project_id: "project-acme",
          vercel_team_id: "team-acme",
          vercel_project_id: "project-acme",
          created_at: "2026-04-01T11:57:00.000Z",
        },
      }) as never,
    readDevLog: async () => "dev log output",
    checkSandboxHealth: async () =>
      ({
        status: "app_error",
        statusCode: 503,
        message: "Preview failed while booting",
      }) as never,
    loadVercelDiagnostics: async () => ({
      state: "build_failed",
      deploymentId: "dpl_fail",
      deploymentUrl: "https://failed-app.vercel.app",
      deploymentStatus: "ERROR",
      buildSummary: "Error: Missing NEXT_PUBLIC_API_URL",
      detectedAt: "2026-04-01T12:05:00.000Z",
    }),
    updateSandboxRecord: async () => ({ id: "sandbox-3" }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ id: "sandbox-3", suffix: "/health" }),
    buildSandboxRouteParams("sandbox-3")
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(
    payload.sandbox.runtime_summary.vercel_diagnostics.state,
    "build_failed"
  );
  assert.equal(
    payload.sandbox.error_summary.display_error,
    "Error: Missing NEXT_PUBLIC_API_URL"
  );
  assert.equal(
    payload.sandbox.error_summary.last_preview_error,
    "Error: Missing NEXT_PUBLIC_API_URL"
  );
});

test("GET /api/sandbox/[id]/health rejects when sandbox health persistence fails", async () => {
  const { createSandboxHealthGetHandler } =
    await loadSandboxHealthRouteModule();

  const handler = createSandboxHealthGetHandler({
    loadOwnedSandboxRouteContext: async () =>
      buildLoadedSandboxHealthRouteContext({
        auth: {
          vercelToken: "user-token",
          vercelTeamId: "team-acme",
          vercelProjectId: "project-acme",
          userVercelToken: "user-token",
          userVercelTeamId: "team-acme",
        },
        record: {
          id: "sandbox-4",
          billing_source: "user_vercel_project",
          billing_team_id: "team-acme",
          billing_project_id: "project-acme",
          vercel_team_id: "team-acme",
          vercel_project_id: "project-acme",
          created_at: "2026-04-01T11:57:00.000Z",
          last_active_at: "2026-04-01T12:00:00.000Z",
        },
      }) as never,
    readDevLog: async () => "dev log output",
    checkSandboxHealth: async () =>
      ({
        status: "running",
        statusCode: 200,
        message: null,
      }) as never,
    loadVercelDiagnostics: async () => null,
    updateSandboxRecord: async () => {
      throw new Error("health write failed");
    },
  });

  await assert.rejects(
    () =>
      handler(
        buildSandboxRouteRequest({ id: "sandbox-4", suffix: "/health" }),
        buildSandboxRouteParams("sandbox-4")
      ),
    /health write failed/
  );
});
