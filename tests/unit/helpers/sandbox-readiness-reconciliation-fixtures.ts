import type {
  SandboxContextResult,
  SandboxVercelContext,
} from "@/lib/sandbox/context";
import type { SandboxRecordRow } from "@/lib/types";

export type SandboxReconcileRecordFixture = SandboxRecordRow & {
  repo?: {
    root_directory?: string | null;
    dev_port?: number | null;
    dev_port_auto?: unknown;
  } | null;
};

export async function loadSandboxReadinessReconciliation() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.VERCEL_PROJECT_ID ||= "prj_test0000000000000000000000";
  return import("../../../lib/sandbox/readiness-reconciliation");
}

export function buildSandboxReconcileRecord(
  overrides: Partial<SandboxReconcileRecordFixture> = {}
): SandboxReconcileRecordFixture {
  return {
    id: "sandbox-1",
    user_id: "user-1",
    repo_id: "repo-1",
    sandbox_id: "vm_123",
    base_branch: "main",
    working_branch: "main",
    limit_claim_id: null,
    vercel_team_id: null,
    vercel_project_id: "project-1",
    sandbox_billing_target: "personal",
    billing_source: "platform",
    billing_team_id: null,
    billing_project_id: "project-1",
    status: "installing",
    preview_url: "https://preview.example.com",
    snapshot_id: null,
    install_log: "",
    dev_log: "",
    health_status: "starting",
    last_health_check_at: null,
    last_preview_http_status: null,
    last_preview_error: null,
    last_boot_error: "Booting",
    boot_attempts: 1,
    last_boot_started_at: "2026-04-01T10:00:00.000Z",
    last_boot_completed_at: null,
    runtime: "node22",
    terminal_cwd: null,
    exec_lock_token: null,
    exec_lock_started_at: null,
    error: "Booting",
    created_at: "2026-04-01T10:00:00.000Z",
    last_active_at: "2026-04-01T10:00:00.000Z",
    repo: { root_directory: null, dev_port: 3000, dev_port_auto: true },
    ...overrides,
  };
}

export function buildResolvedContext(): SandboxContextResult<SandboxVercelContext> {
  return {
    ok: true as const,
    context: {
      ownership: {
        source: "record" as const,
        billingSource: "platform" as const,
        credentialSource: "platform" as const,
        projectId: "project-1",
        teamId: null,
      },
      credentials: {
        vercelToken: "platform-token",
        vercelTeamId: null,
        vercelProjectId: "project-1",
      },
    },
  };
}
