import type { SandboxAiAccess } from "@/lib/sandbox/ai-runtime";
import type { SandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes";

type SandboxServiceRouteAuthFixture = SandboxServiceCredentials;

type SandboxServiceRecordRepoFixture = {
  full_name: string | null;
  root_directory: string | null;
  sandbox_env_vars: unknown;
  env_sync_mode: string | null;
  vercel_project_id: string | null;
  vercel_team_id: string | null;
  github_installation_id?: number | null;
};

type SandboxServiceRouteRecordFixture = {
  repo_id: string | null;
  sandbox_id: string;
  base_branch: string;
  working_branch: string;
  billing_source: string | null;
  billing_team_id: string | null;
  billing_project_id: string | null;
  vercel_team_id: string | null;
  vercel_project_id: string | null;
  preview_url: string | null;
  repo:
    | SandboxServiceRecordRepoFixture
    | SandboxServiceRecordRepoFixture[]
    | null;
};

type SandboxServiceAiAccessFixture = SandboxAiAccess;

type SandboxServiceWorkspaceFixture = {
  id?: string;
  sandbox_billing_mode: string | null;
  sandbox_timeout_ms?: number | null;
  sandbox_vercel_project_id: string | null;
  sandbox_vercel_team_id: string | null;
};

type SandboxServiceRepoFixture = {
  id: string;
  user_id: string;
  full_name: string;
  default_branch: string | null;
  root_directory: string | null;
  sandbox_billing_target: string | null;
  sandbox_billing_mode_override: string | null;
  runtime: SandboxRuntime | null;
  dev_port: number;
  sandbox_timeout_ms: number | null;
  snapshot_id: string | null;
  snapshot_created_at: string | null;
  snapshot_billing_source: string | null;
  snapshot_billing_team_id: string | null;
  snapshot_billing_project_id: string | null;
  install_command: string | null;
  dev_command: string | null;
  sandbox_env_vars: unknown;
  env_sync_mode: string | null;
  vercel_project_id: string | null;
  vercel_team_id: string | null;
  workspace:
    | SandboxServiceWorkspaceFixture
    | SandboxServiceWorkspaceFixture[]
    | null;
};

const defaultSandboxServiceRouteAuth: SandboxServiceRouteAuthFixture = {
  userId: "user-123",
  vercelToken: "vercel-token",
  vercelTeamId: null,
  vercelProjectId: "project-123",
  userVercelToken: null,
  userVercelTeamId: null,
  accountDefaultVercelProjectId: null,
  accountDefaultVercelTeamId: null,
};

const defaultSandboxServiceRecordRepo: SandboxServiceRecordRepoFixture = {
  full_name: "acme/repo",
  root_directory: null,
  sandbox_env_vars: null,
  env_sync_mode: "sandbox-only",
  vercel_project_id: null,
  vercel_team_id: null,
};

const defaultSandboxServiceRouteRecord: SandboxServiceRouteRecordFixture = {
  repo_id: "repo-123",
  sandbox_id: "sandbox-runtime-123",
  base_branch: "main",
  working_branch: "mogplex/test-branch",
  billing_source: "platform",
  billing_team_id: null,
  billing_project_id: "project-123",
  vercel_team_id: null,
  vercel_project_id: "project-123",
  preview_url: "https://preview.example.com",
  repo: { ...defaultSandboxServiceRecordRepo },
};

const defaultSandboxServiceAiAccess: SandboxServiceAiAccessFixture = {
  aiBillingSource: null,
  gatewayApiKey: null,
  platformAccessRestricted: false,
  providerKeys: {
    anthropic: null,
    openai: null,
  },
};

const defaultSandboxServiceWorkspace: SandboxServiceWorkspaceFixture = {
  id: "ws-1",
  sandbox_billing_mode: "platform",
  sandbox_timeout_ms: null,
  sandbox_vercel_project_id: null,
  sandbox_vercel_team_id: null,
};

const defaultSandboxServiceRepo: SandboxServiceRepoFixture = {
  id: "repo-123",
  user_id: "user-123",
  full_name: "acme/repo",
  default_branch: "main",
  root_directory: null,
  sandbox_billing_target: null,
  sandbox_billing_mode_override: null,
  runtime: "node22",
  dev_port: 3000,
  sandbox_timeout_ms: 300_000,
  snapshot_id: null,
  snapshot_created_at: null,
  snapshot_billing_source: null,
  snapshot_billing_team_id: null,
  snapshot_billing_project_id: null,
  install_command: null,
  dev_command: null,
  sandbox_env_vars: null,
  env_sync_mode: "sandbox-only",
  vercel_project_id: null,
  vercel_team_id: null,
  workspace: null,
};

function ensureSandboxServiceRouteTestEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
}

export async function loadSandboxExecRouteModule() {
  ensureSandboxServiceRouteTestEnv();
  return import("../../app/api/sandbox/[id]/exec/route");
}

export async function loadSandboxHarnessRouteModule() {
  ensureSandboxServiceRouteTestEnv();
  return import("../../app/api/sandbox/[id]/harness/route");
}

export async function loadSandboxRouteModule() {
  ensureSandboxServiceRouteTestEnv();
  return import("../../app/api/sandbox/route");
}

export async function loadSnapshotRouteModule() {
  ensureSandboxServiceRouteTestEnv();
  return import("../../app/api/repos/[id]/snapshot/route");
}

export function buildSandboxServiceRouteAuth(
  overrides: Partial<SandboxServiceRouteAuthFixture> = {}
) {
  return {
    ...defaultSandboxServiceRouteAuth,
    ...overrides,
  };
}

export function buildSandboxServiceRecordRepo(
  overrides: Partial<SandboxServiceRecordRepoFixture> = {}
) {
  return {
    ...defaultSandboxServiceRecordRepo,
    ...overrides,
  };
}

export function buildOwnedSandboxServiceRecord({
  record = {},
  repo,
}: {
  record?: Partial<SandboxServiceRouteRecordFixture>;
  repo?: SandboxServiceRecordRepoFixture | null;
} = {}) {
  return {
    ...defaultSandboxServiceRouteRecord,
    ...record,
    repo:
      record.repo ??
      (repo === undefined ? buildSandboxServiceRecordRepo() : repo),
  };
}

export function buildSandboxServiceWorkspace(
  overrides: Partial<SandboxServiceWorkspaceFixture> = {}
) {
  return {
    ...defaultSandboxServiceWorkspace,
    ...overrides,
  };
}

export function buildSandboxServiceRepo({
  repo = {},
  workspace,
}: {
  repo?: Partial<SandboxServiceRepoFixture>;
  workspace?: SandboxServiceRepoFixture["workspace"];
} = {}) {
  return {
    ...defaultSandboxServiceRepo,
    ...repo,
    workspace:
      repo.workspace ??
      (workspace === undefined
        ? defaultSandboxServiceRepo.workspace
        : workspace),
  };
}

export function buildOwnedRepoWithGithubAccess({
  repo = {},
  workspace,
  githubToken = "github-token",
}: {
  repo?: Partial<SandboxServiceRepoFixture>;
  workspace?: SandboxServiceRepoFixture["workspace"];
  githubToken?: string | null;
} = {}) {
  return {
    repo: buildSandboxServiceRepo({ repo, workspace }),
    githubToken,
  };
}

export function buildSandboxServiceAiAccess({
  providerKeys,
  ...overrides
}: Omit<Partial<SandboxServiceAiAccessFixture>, "providerKeys"> & {
  providerKeys?: Partial<SandboxServiceAiAccessFixture["providerKeys"]>;
} = {}) {
  return {
    ...defaultSandboxServiceAiAccess,
    ...overrides,
    providerKeys: providerKeys
      ? {
          ...defaultSandboxServiceAiAccess.providerKeys,
          ...providerKeys,
        }
      : { ...defaultSandboxServiceAiAccess.providerKeys },
  };
}

export function buildSandboxCollectionRequest({
  method = "GET",
  init,
}: {
  method?: "GET" | "POST";
  init?: RequestInit;
} = {}) {
  return new Request("http://localhost/api/sandbox", {
    ...init,
    method: init?.method ?? method,
  });
}

export function buildRepoSnapshotRequest({
  id = "repo-123",
  method = "POST",
  init,
}: {
  id?: string;
  method?: "GET" | "POST" | "DELETE";
  init?: RequestInit;
} = {}) {
  return new Request(`http://localhost/api/repos/${id}/snapshot`, {
    ...init,
    method: init?.method ?? method,
  });
}

export function buildRepoRouteParams(id = "repo-123") {
  return {
    params: Promise.resolve({ id }),
  };
}
