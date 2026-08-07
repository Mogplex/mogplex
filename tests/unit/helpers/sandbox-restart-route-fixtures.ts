export type PersistentRestartRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string | null;
  working_branch: string | null;
  status: string;
  health_status: string | null;
  preview_url: string | null;
  snapshot_id: string | null;
  runtime: string | null;
  terminal_cwd: string | null;
  root_directory: string | null;
  persistent: boolean | null;
  created_at: string;
  last_active_at: string | null;
  repo: {
    root_directory: string | null;
    dev_command: string | null;
    dev_port: number | null;
    dev_port_auto: boolean;
    runtime?: string | null;
    vercel_project_id: string | null;
    vercel_team_id: string | null;
  };
};

export function buildLoadedPersistentRestartContext(
  overrides: Partial<PersistentRestartRecord> = {}
) {
  return {
    ok: true as const,
    auth: {
      userId: "user-1",
      vercelToken: "platform-token",
      vercelTeamId: null,
      vercelProjectId: "project-1",
      userVercelToken: null,
      userVercelTeamId: null,
    },
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
      status: "running",
      health_status: "running",
      preview_url: "https://preview.example.com",
      snapshot_id: "snap_abc",
      runtime: "node22",
      terminal_cwd: null,
      root_directory: null,
      persistent: true,
      created_at: "2026-04-01T10:00:00.000Z",
      last_active_at: "2026-04-01T10:00:00.000Z",
      repo: {
        root_directory: null,
        dev_command: null,
        dev_port: 3000,
        dev_port_auto: true,
        runtime: "node22",
        vercel_project_id: "project-1",
        vercel_team_id: null,
      },
      ...overrides,
    },
  };
}

export function buildPersistedPersistentRestartRecord(
  updates: Partial<PersistentRestartRecord> = {}
): PersistentRestartRecord {
  return {
    ...buildLoadedPersistentRestartContext().record,
    ...updates,
  };
}
