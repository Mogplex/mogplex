import { defaultSandboxAuth } from "../sandbox-record-route-test-harness/shared";

export type ResumeRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string | null;
  working_branch: string | null;
  status: string;
  stop_reason: string | null;
  health_status: string | null;
  preview_url: string | null;
  snapshot_id: string | null;
  runtime: string | null;
  terminal_cwd: string | null;
  root_directory: string | null;
  persistent: boolean | null;
  created_at: string;
  last_active_at: string | null;
  repo: unknown;
};

export function buildLoadedResumeContext(
  overrides: Partial<ResumeRecord> = {}
) {
  return {
    ok: true as const,
    auth: { ...defaultSandboxAuth },
    repo: null,
    rootDirectory: undefined,
    context: {
      credentials: {
        vercelToken: "platform-token",
        vercelTeamId: null,
        vercelProjectId: "project-1",
      },
    },
    sandbox: null,
    record: {
      id: "sandbox-1",
      user_id: "user-1",
      repo_id: "repo-1",
      sandbox_id: "vm_123",
      base_branch: "main",
      working_branch: "feature-a",
      status: "paused",
      stop_reason: null,
      health_status: "paused",
      preview_url: "https://preview.example.com",
      snapshot_id: "snap_abc",
      runtime: "node22",
      terminal_cwd: null,
      root_directory: null,
      persistent: true,
      created_at: "2026-04-01T10:00:00.000Z",
      last_active_at: "2026-04-01T10:00:00.000Z",
      repo: {
        id: "repo-1",
        root_directory: null,
        dev_command: null,
        dev_port: 3000,
        dev_port_auto: true,
        runtime: "node22",
        sandbox_env_vars: null,
        env_sync_mode: "sandbox-only",
        vercel_project_id: "project-1",
        vercel_team_id: null,
      },
      ...overrides,
    },
  };
}

export function buildPersistedResumeRecord(
  updates: Partial<ResumeRecord> = {}
): ResumeRecord {
  return {
    ...buildLoadedResumeContext().record,
    ...updates,
  };
}
