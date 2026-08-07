import assert from "node:assert/strict";

import type { MogplexApiAutomation } from "../../../lib/mogplex-api/automations";
import type { MogplexMcpClient } from "../../../lib/mogplex-api/mcp";
import type { MogplexApiRunDetail } from "../../../lib/mogplex-api/runs";

export type SingleMcpResponse = {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: unknown;
};

export async function loadMcpRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../app/api/v1/mogplex/mcp/route");
}

export function buildRun(
  overrides: Partial<MogplexApiRunDetail> = {}
): MogplexApiRunDetail {
  return {
    runId: "run-1",
    aiCallId: "call-1",
    sandboxRecordId: "sandbox-record-1",
    sandboxId: "sbx_123",
    repoId: "repo-1",
    harness: "codex",
    status: "pending",
    branch: {
      base: "main",
      working: "mogplex/external/run-1",
      createBranch: true,
    },
    rootDirectory: null,
    eventsUrl: "/api/v1/mogplex/runs/run-1/events",
    cancelUrl: "/api/v1/mogplex/runs/run-1/cancel",
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
    error: null,
    runtime: {
      provider: "trigger",
      runId: "trigger-run-1",
    },
    ...overrides,
  };
}

export function buildFakeMcpClient(
  overrides: Partial<MogplexMcpClient> = {}
): MogplexMcpClient {
  const run = buildRun();
  const automation: MogplexApiAutomation = {
    id: "automation-1",
    installationId: 123,
    name: "Review PRs",
    description: null,
    notes: null,
    status: "active",
    draftGraph: { nodes: [], edges: [] },
    publishedVersion: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    runSummary: {
      lastRunId: null,
      lastRunStatus: null,
      runningCount: 0,
      pendingCount: 0,
      failed24h: 0,
    },
  };
  return {
    listAgents: async () => ({ agents: [] }),
    listModels: async () => ({ models: [] }),
    listRepos: async () => ({ repos: [] }),
    listRepoEnvVars: async () => ({ envVars: [] }),
    upsertRepoEnvVar: async () => ({
      action: "created",
      key: "API_KEY",
      updatedCount: 1,
    }),
    deleteRepoEnvVar: async () => ({ key: "API_KEY", deletedCount: 1 }),
    listSandboxes: async () => ({ sandboxes: [] }),
    createSandbox: async () => ({
      sandbox: {
        id: "sandbox-record-1",
        sandbox_id: "sbx_123",
        repo_id: "repo-1",
        status: "running",
        base_branch: "main",
        working_branch: "main",
        root_directory: null,
        preview_url: null,
        created_at: "2026-07-20T00:00:00.000Z",
        last_active_at: "2026-07-20T00:00:00.000Z",
        error: null,
      },
    }),
    getSandboxLogs: async () => ({
      sandbox: {
        id: "sandbox-record-1",
        sandbox_id: "sbx_123",
        repo_id: "repo-1",
        status: "running",
        base_branch: "main",
        working_branch: "main",
        root_directory: null,
        preview_url: null,
        created_at: "2026-07-20T00:00:00.000Z",
        last_active_at: "2026-07-20T00:00:00.000Z",
        error: null,
        install_log: "installed",
        dev_log: "ready",
      },
      lifecycle_events: [],
    }),
    listAutomations: async () => ({
      automations: [
        {
          id: automation.id,
          installationId: automation.installationId,
          name: automation.name,
          description: automation.description,
          status: automation.status,
          publishedVersionId: null,
          createdAt: automation.createdAt,
          updatedAt: automation.updatedAt,
        },
      ],
      nextCursor: null,
    }),
    getAutomation: async () => ({ automation }),
    createAutomation: async () => ({ automation }),
    updateAutomation: async () => ({ automation }),
    publishAutomation: async () => ({ automation }),
    setAutomationModel: async () => ({ automation }),
    triggerAutomation: async () => ({
      run: {
        automationId: automation.id,
        jobRunId: "job-1",
        outcome: "queued",
        reason: null,
        started: true,
        status: "running",
        runtime: { provider: "trigger", runId: "runtime-1" },
      },
    }),
    listAutomationRuns: async () => ({ runs: [] }),
    getAutomationRunLogs: async () => ({ run: { id: "job-1" } as never }),
    startAgentRun: async () => ({ ...run, replayed: false }),
    getRun: async () => ({ run }),
    getRunEvents: async () => ({ run, events: [] }),
    cancelRun: async () => ({
      run: buildRun({ status: "cancelled" }),
      status: "cancelled",
    }),
    ...overrides,
  };
}

export function assertSingleMcpResponse(response: unknown): SingleMcpResponse {
  assert.ok(response);
  assert.equal(Array.isArray(response), false);
  return response as SingleMcpResponse;
}
