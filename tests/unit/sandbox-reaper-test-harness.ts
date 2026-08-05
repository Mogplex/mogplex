import type { SandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";
import type {
  ActiveSandboxLivenessResult,
  SandboxVmCredentials,
} from "@/lib/sandbox/liveness";
import type {
  ReaperSandboxCredentials,
  StaleStoppedSandboxRecord,
} from "@/lib/sandbox/reaper-helpers";

type PlatformSandboxCredentialsFixture = Pick<
  SandboxServiceCredentials,
  "vercelToken" | "vercelTeamId" | "vercelProjectId"
>;

type UserVercelCredentialsFixture = Pick<
  SandboxServiceCredentials,
  | "userVercelToken"
  | "userVercelTeamId"
  | "accountDefaultVercelProjectId"
  | "accountDefaultVercelTeamId"
>;

type ReaperSandboxRecordRepoFixture = {
  sandbox_timeout_ms: number | null;
  workspace:
    | {
        sandbox_timeout_ms: number | null;
      }
    | Array<{
        sandbox_timeout_ms: number | null;
      }>
    | null;
};

type ReaperSandboxRecordFixture = {
  id: string;
  sandbox_id: string;
  user_id: string;
  status: string;
  health_status: string;
  exec_lock_token: string | null;
  created_at: string;
  last_active_at: string | null;
  billing_source: string | null;
  billing_team_id: string | null;
  billing_project_id: string | null;
  vercel_team_id: string | null;
  vercel_project_id: string | null;
  persistent: boolean | null;
  repo:
    | ReaperSandboxRecordRepoFixture
    | ReaperSandboxRecordRepoFixture[]
    | null;
};

type ResolvedReaperLivenessKind = Extract<
  ActiveSandboxLivenessResult["kind"],
  "running" | "pending" | "stopped"
>;

const defaultPlatformSandboxCredentials: PlatformSandboxCredentialsFixture = {
  vercelToken: "platform-token",
  vercelTeamId: null,
  vercelProjectId: "platform-project",
};

const defaultUserVercelCredentials: UserVercelCredentialsFixture = {
  userVercelToken: null,
  userVercelTeamId: null,
  accountDefaultVercelProjectId: null,
  accountDefaultVercelTeamId: null,
};

const defaultReaperSandboxVmCredentials: SandboxVmCredentials = {
  vercelToken: "resolved-token",
  vercelTeamId: null,
  vercelProjectId: "project-123",
};

const defaultReaperSandboxRecord: ReaperSandboxRecordFixture = {
  id: "sandbox-1",
  sandbox_id: "vm_123",
  user_id: "user-123",
  status: "running",
  health_status: "running",
  exec_lock_token: null,
  created_at: "2026-04-01T10:00:00.000Z",
  last_active_at: "2026-04-01T10:00:00.000Z",
  billing_source: "platform",
  billing_team_id: null,
  billing_project_id: "project-123",
  vercel_team_id: null,
  vercel_project_id: "project-123",
  persistent: false,
  repo: {
    sandbox_timeout_ms: 600_000,
    workspace: null,
  },
};

const defaultReaperStaleStoppedSandbox: StaleStoppedSandboxRecord = {
  id: "sandbox-stale-1",
  sandbox_id: "vm_stale_123",
  health_status: "app_error",
};

const defaultReaperCredentialFailure =
  "Sandbox is missing its stored Vercel project for user-owned billing.";

function ensureSandboxReaperTestEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.VERCEL_PROJECT_ID ||= "prj_test0000000000000000000000";
}

export async function loadSandboxReaperRouteModule() {
  ensureSandboxReaperTestEnv();
  const routeModule = await import("../../app/api/cron/sandbox-reaper/route");
  return {
    ...routeModule,
    createSandboxReaperGetHandler: (
      overrides: Parameters<
        typeof routeModule.createSandboxReaperGetHandler
      >[0] = {}
    ) =>
      routeModule.createSandboxReaperGetHandler({
        prepareSandboxBillingClose: async () => null,
        finalizeSandboxBillingClose: async () => ({
          finalized: false,
          metered: false,
        }),
        ...overrides,
      }),
    stopSandbox: (
      sandbox: Parameters<typeof routeModule.stopSandbox>[0],
      credentials: Parameters<typeof routeModule.stopSandbox>[1],
      options: Parameters<typeof routeModule.stopSandbox>[2],
      deps: NonNullable<Parameters<typeof routeModule.stopSandbox>[3]>
    ) =>
      routeModule.stopSandbox(sandbox, credentials, options, {
        prepareSandboxBillingClose: async () => null,
        finalizeSandboxBillingClose: async () => ({
          finalized: false,
          metered: false,
        }),
        ...deps,
      }),
  };
}

export function buildSandboxReaperRequest() {
  return new Request("http://localhost/api/cron/sandbox-reaper");
}

export function buildPlatformSandboxCredentials(
  overrides: Partial<PlatformSandboxCredentialsFixture> = {}
) {
  return {
    ...defaultPlatformSandboxCredentials,
    ...overrides,
  };
}

export function buildUserVercelCredentials(
  overrides: Partial<UserVercelCredentialsFixture> = {}
) {
  return {
    ...defaultUserVercelCredentials,
    ...overrides,
  };
}

export function buildReaperSandboxVmCredentials(
  overrides: Partial<SandboxVmCredentials> = {}
) {
  return {
    ...defaultReaperSandboxVmCredentials,
    ...overrides,
  };
}

export function buildReaperSandboxCredentials(
  overrides: Partial<Extract<ReaperSandboxCredentials, { ok: true }>> = {}
) {
  return {
    ok: true as const,
    ...buildReaperSandboxVmCredentials(),
    ...overrides,
  };
}

export function buildReaperCredentialFailure(
  error = defaultReaperCredentialFailure
) {
  return {
    ok: false as const,
    error,
  };
}

export function buildReaperResolvedLiveness(
  kind: ResolvedReaperLivenessKind,
  overrides: Partial<SandboxVmCredentials> = {}
): ActiveSandboxLivenessResult {
  if (kind === "pending") {
    if (Object.keys(overrides).length === 0) {
      return { kind };
    }

    return {
      kind,
      credentials: buildReaperSandboxVmCredentials(overrides),
    };
  }

  return {
    kind,
    credentials: buildReaperSandboxVmCredentials(overrides),
  };
}

export function buildReaperUnresolvableLiveness(
  overrides: Partial<
    Extract<ActiveSandboxLivenessResult, { kind: "unresolvable" }>
  > = {}
): ActiveSandboxLivenessResult {
  return {
    kind: "unresolvable",
    error: defaultReaperCredentialFailure,
    status: 400,
    ...overrides,
  };
}

export function buildReaperSandboxRecord(
  overrides: Partial<ReaperSandboxRecordFixture> = {}
) {
  return {
    ...defaultReaperSandboxRecord,
    ...overrides,
  };
}

export function buildReaperStaleStoppedSandbox(
  overrides: Partial<StaleStoppedSandboxRecord> = {}
) {
  return {
    ...defaultReaperStaleStoppedSandbox,
    ...overrides,
  };
}
