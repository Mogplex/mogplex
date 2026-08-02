export type SandboxAuthFixture = {
  userId: string;
  vercelToken: string;
  vercelTeamId: string | null;
  vercelProjectId: string | null;
  userVercelToken: string | null;
  userVercelTeamId: string | null;
};

export type SandboxCredentialsFixture = {
  vercelToken: string;
  vercelTeamId: string | null;
  vercelProjectId: string | null;
};

export type SandboxBaseRecordFixture = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string;
  working_branch: string;
  status: string;
  billing_source: string | null;
  billing_team_id: string | null;
  billing_project_id: string | null;
  vercel_team_id: string | null;
  vercel_project_id: string | null;
  persistent?: boolean | null;
};

export type SandboxDetailRecordFixture = SandboxBaseRecordFixture & {
  snapshot_id: string | null;
  install_log: string | null;
  dev_log: string | null;
  runtime: string | null;
  terminal_cwd: string | null;
  preview_url: string | null;
  persistent: boolean | null;
  health_status: string | null;
  error: string | null;
  last_preview_error: string | null;
  last_boot_error: string | null;
  created_at: string;
  last_active_at: string | null;
};

export type SandboxRestartRecordFixture = {
  id: string;
  repo_id: string | null;
  sandbox_id: string;
  base_branch: string | null;
  working_branch: string | null;
  status: string;
  billing_source: string | null;
  billing_team_id: string | null;
  billing_project_id: string | null;
  vercel_team_id: string | null;
  vercel_project_id: string | null;
};

export type SandboxRouteRepoFixture = {
  root_directory: string | null;
};

export type SandboxTerminalRecordFixture = {
  id: string;
  sandbox_id: string;
  billing_source: string | null;
  billing_team_id: string | null;
  billing_project_id: string | null;
  vercel_team_id: string | null;
  vercel_project_id: string | null;
  preview_url: string | null;
  repo: SandboxRouteRepoFixture | SandboxRouteRepoFixture[] | null;
};

export type SandboxTerminalProxyRecordFixture = {
  id: string;
  sandbox_id: string;
};

export type SandboxTerminalProxyFixture = {
  recordId: string;
  sandboxRuntimeId: string;
  baseUrl: string;
  expiresAt: number;
};

export type SandboxOwnershipFixture = {
  source: string;
  billingSource: string | null;
  credentialSource: string;
  projectId: string | null;
  teamId: string | null;
};

export type SandboxHealthRecordFixture = SandboxDetailRecordFixture & {
  last_health_check_at: string | null;
  last_preview_http_status: number | null;
  boot_attempts: number | null;
  last_boot_started_at: string | null;
  last_boot_completed_at: string | null;
  repo: SandboxRouteRepoFixture | SandboxRouteRepoFixture[] | null;
};

export type BuildLoadedSandboxHealthRouteContextOptions = {
  auth?: Partial<SandboxAuthFixture>;
  record?: Partial<SandboxHealthRecordFixture>;
  repo?: SandboxRouteRepoFixture | null;
  rootDirectory?: string;
  ownership?: Partial<SandboxOwnershipFixture>;
  credentials?: Partial<SandboxCredentialsFixture>;
  sandbox?: Record<string, unknown> | null;
};

export type BuildLoadedSandboxTerminalRouteContextOptions = {
  auth?: Partial<SandboxAuthFixture>;
  record?: Partial<SandboxTerminalRecordFixture>;
  repo?: SandboxRouteRepoFixture | null;
  rootDirectory?: string;
  credentials?: Partial<SandboxCredentialsFixture>;
  sandbox?: Record<string, unknown> | null;
};

export type BuildLoadedValidatedTerminalProxyRequestOptions = {
  auth?: Partial<SandboxAuthFixture>;
  record?: Partial<SandboxTerminalProxyRecordFixture>;
  proxy?: Partial<SandboxTerminalProxyFixture>;
  bridgeToken?: string;
  repo?: SandboxRouteRepoFixture | null;
  rootDirectory?: string;
};

export const defaultSandboxAuth: SandboxAuthFixture = {
  userId: "user-1",
  vercelToken: "platform-token",
  vercelTeamId: null,
  vercelProjectId: "project-1",
  userVercelToken: null,
  userVercelTeamId: null,
};

export const defaultSandboxCredentials: SandboxCredentialsFixture = {
  vercelToken: "platform-token",
  vercelTeamId: null,
  vercelProjectId: "project-1",
};

export const defaultSandboxBaseRecord: SandboxBaseRecordFixture = {
  id: "sandbox-1",
  user_id: "user-1",
  repo_id: "repo-1",
  sandbox_id: "vm_123",
  base_branch: "main",
  working_branch: "feature-a",
  status: "running",
  billing_source: "platform",
  billing_team_id: null,
  billing_project_id: "project-1",
  vercel_team_id: null,
  vercel_project_id: "project-1",
};

export const defaultSandboxDetailRecord: SandboxDetailRecordFixture = {
  ...defaultSandboxBaseRecord,
  snapshot_id: null,
  install_log: null,
  dev_log: null,
  runtime: "node22",
  terminal_cwd: null,
  preview_url: "https://preview.example.com",
  persistent: false,
  health_status: "running",
  error: null,
  last_preview_error: null,
  last_boot_error: null,
  created_at: "2026-04-01T10:00:00.000Z",
  last_active_at: "2026-04-01T10:05:00.000Z",
};

export const defaultSandboxRestartRecord: SandboxRestartRecordFixture = {
  id: "sandbox-1",
  repo_id: "repo-1",
  sandbox_id: "vm_123",
  base_branch: "main",
  working_branch: "feature-a",
  status: "running",
  billing_source: "platform",
  billing_team_id: null,
  billing_project_id: "project-1",
  vercel_team_id: null,
  vercel_project_id: "project-1",
};

export const defaultSandboxRepo: SandboxRouteRepoFixture = {
  root_directory: null,
};

export const defaultSandboxTerminalRepo: SandboxRouteRepoFixture = {
  root_directory: "apps/docs",
};

export const defaultSandboxHealthRecord: SandboxHealthRecordFixture = {
  ...defaultSandboxDetailRecord,
  install_log: "",
  dev_log: "",
  last_health_check_at: null,
  last_preview_http_status: null,
  boot_attempts: 2,
  last_boot_started_at: "2026-04-01T11:58:00.000Z",
  last_boot_completed_at: "2026-04-01T11:59:00.000Z",
  repo: { ...defaultSandboxRepo },
};

export const defaultSandboxTerminalRecord: SandboxTerminalRecordFixture = {
  id: "sandbox-record-1",
  sandbox_id: "vm_123",
  billing_source: "platform",
  billing_team_id: null,
  billing_project_id: "project-1",
  vercel_team_id: null,
  vercel_project_id: "project-1",
  preview_url: "https://preview.example.com",
  repo: { ...defaultSandboxTerminalRepo },
};

export const defaultSandboxTerminalProxyRecord: SandboxTerminalProxyRecordFixture =
  {
    id: "sandbox-record-1",
    sandbox_id: "vm_123",
  };

export const defaultSandboxTerminalProxy: SandboxTerminalProxyFixture = {
  recordId: "sandbox-record-1",
  sandboxRuntimeId: "vm_123",
  baseUrl: "https://bridge.example.vercel.run",
  expiresAt: 999_999,
};
