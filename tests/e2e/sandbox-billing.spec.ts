import { expect, test } from "@playwright/test";
import { enableE2EAuth } from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import {
  buildObservabilitySummary,
  buildSandboxBackedCall,
} from "./helpers/sandbox-fixtures";
import type { Page, Route } from "@playwright/test";

const connectedUser = {
  id: "user-1",
  email: "alex@example.com",
  username: "alex",
  name: "Alex",
  avatar_url: "https://example.com/avatar.png",
  github_connected: true,
  github_app_connected: true,
  github_app_available: true,
  github_connection_mode: "app" as const,
  vercel: linkedVercelCapability,
};

const model = {
  id: "minimax/minimax-m2.5",
  provider: "minimax",
  name: "MiniMax M2.5",
  context_length: 1000000,
  pricing_input: 0.0000008,
  pricing_output: 0.0000032,
  capabilities: ["reasoning", "tool-calling"],
  is_available: true,
  is_enabled: true,
};

type WorkspaceFixture = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  sandbox_billing_mode: "platform" | "user_vercel_project";
  sandbox_vercel_team_id: string | null;
  sandbox_vercel_project_id: string | null;
  repo_count: number;
  created_at: string;
  updated_at: string;
};

type RepoFixture = {
  id: string;
  user_id: string;
  workspace_id: string;
  full_name: string;
  owner: string;
  name: string;
  default_branch: string;
  github_id: number;
  github_installation_id: number;
  github_has_app_installation: boolean;
  github_app_covered: boolean;
  github_triggerable: boolean;
  github_access_state: "app_covered";
  is_favorite: boolean;
  sandbox_billing_mode_override: "platform" | "user_vercel_project" | null;
  sandbox_billing_target: "personal" | "team";
  vercel_team_id: string | null;
  vercel_project_id: string | null;
  env_sync_mode: "sandbox-only" | "sandbox-and-preview" | "vercel-project";
  root_directory: string | null;
  install_command: string | null;
  dev_command: string | null;
  dev_port: number;
  dev_port_auto: boolean;
  sandbox_timeout_ms: number;
  sandbox_env_vars: Record<string, string> | null;
  created_at: string;
  workspace: WorkspaceFixture;
};

type VercelTeam = { id: string; name: string };
type VercelProject = { id: string; name: string; framework?: string | null };

type BillingState = {
  workspace: WorkspaceFixture;
  repo: RepoFixture;
  teams: VercelTeam[];
  projectsByTeam: Record<string, VercelProject[]>;
  targetsError: "VERCEL_NOT_CONNECTED" | "VERCEL_AUTH_INVALID" | null;
  validationErrorsByProjectId: Record<
    string,
    "PROJECT_NOT_FOUND" | "PROJECT_FORBIDDEN" | "AUTH_INVALID"
  >;
  workspacePatchBodies: Array<Record<string, unknown>>;
  repoPatchBodies: Array<Record<string, unknown>>;
};

function buildWorkspace(
  overrides: Partial<WorkspaceFixture> = {}
): WorkspaceFixture {
  return {
    id: "workspace-1",
    user_id: "user-1",
    name: "Core",
    description: "Main project workspace",
    is_default: true,
    sandbox_billing_mode: "platform",
    sandbox_vercel_team_id: null,
    sandbox_vercel_project_id: null,
    repo_count: 1,
    created_at: "2026-03-31T00:00:00.000Z",
    updated_at: "2026-03-31T00:00:00.000Z",
    ...overrides,
  };
}

function buildRepo(
  workspace: WorkspaceFixture,
  overrides: Partial<RepoFixture> = {}
): RepoFixture {
  return {
    id: "repo-1",
    user_id: "user-1",
    workspace_id: workspace.id,
    full_name: "acme/credit-renew",
    owner: "acme",
    name: "credit-renew",
    default_branch: "main",
    github_id: 101,
    github_installation_id: 202,
    github_has_app_installation: true,
    github_app_covered: true,
    github_triggerable: true,
    github_access_state: "app_covered",
    is_favorite: true,
    sandbox_billing_mode_override: null,
    sandbox_billing_target: "personal",
    vercel_team_id: null,
    vercel_project_id: null,
    env_sync_mode: "sandbox-only",
    root_directory: "web",
    install_command: null,
    dev_command: null,
    dev_port: 3000,
    dev_port_auto: true,
    sandbox_timeout_ms: 10 * 60 * 1000,
    sandbox_env_vars: null,
    created_at: "2026-03-31T00:00:00.000Z",
    workspace,
    ...overrides,
  };
}

function createBillingState(options?: {
  workspace?: Partial<WorkspaceFixture>;
  repo?: Partial<RepoFixture>;
  projectsByTeam?: Record<string, VercelProject[]>;
}): BillingState {
  const workspace = buildWorkspace(options?.workspace);
  const repo = buildRepo(workspace, options?.repo);

  return {
    workspace,
    repo,
    teams: [
      { id: "personal", name: "Personal" },
      { id: "team-acme", name: "Acme Team" },
    ],
    projectsByTeam: {
      personal: [
        { id: "personal-app", name: "Personal App", framework: "nextjs" },
      ],
      "team-acme": [
        { id: "workspace-app", name: "Workspace App", framework: "nextjs" },
        { id: "repo-app", name: "Repo App", framework: "nextjs" },
      ],
      ...options?.projectsByTeam,
    },
    targetsError: null,
    validationErrorsByProjectId: {},
    workspacePatchBodies: [],
    repoPatchBodies: [],
  };
}

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

async function installBaseMocks(page: Page, state: BillingState) {
  await enableE2EAuth(page);

  const currentRepo = () => ({
    ...state.repo,
    workspace: { ...state.workspace },
  });

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, (route) =>
    fulfillJson(route, { default_model: model.id, theme: "dark" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, { models: [model], catalog: [model] })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/settings/keys", (route) =>
    fulfillJson(route, { keys: [] })
  );
  await page.route(/\/api\/workspaces(?:\?.*)?$/, (route) =>
    fulfillJson(route, [{ ...state.workspace }])
  );
  await page.route(/\/api\/workspaces\/[^/?]+(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = JSON.parse(route.request().postData() || "{}") as Record<
        string,
        unknown
      >;
      state.workspacePatchBodies.push(payload);
      state.workspace = {
        ...state.workspace,
        name:
          typeof payload.name === "string"
            ? payload.name
            : state.workspace.name,
        description:
          typeof payload.description === "string"
            ? payload.description
            : state.workspace.description,
        sandbox_billing_mode:
          (payload.sandbox_billing_mode as WorkspaceFixture["sandbox_billing_mode"]) ||
          state.workspace.sandbox_billing_mode,
        sandbox_vercel_team_id:
          (payload.sandbox_vercel_team_id as string | null | undefined) ?? null,
        sandbox_vercel_project_id:
          (payload.sandbox_vercel_project_id as string | null | undefined) ??
          null,
        updated_at: "2026-04-01T12:00:00.000Z",
      };
      state.repo = { ...state.repo, workspace: { ...state.workspace } };
      await fulfillJson(route, {
        ...state.workspace,
        repo_count: state.workspace.repo_count,
      });
      return;
    }

    await fulfillJson(route, {
      ...state.workspace,
      repo_count: state.workspace.repo_count,
    });
  });
  await page.route(/\/api\/repos(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = JSON.parse(route.request().postData() || "{}") as Record<
        string,
        unknown
      >;
      state.repoPatchBodies.push(payload);
      state.repo = {
        ...state.repo,
        default_branch:
          (payload.default_branch as string | undefined) ||
          state.repo.default_branch,
        vercel_team_id:
          (payload.vercel_team_id as string | null | undefined) ?? null,
        vercel_project_id:
          (payload.vercel_project_id as string | null | undefined) ?? null,
        sandbox_billing_target:
          (payload.sandbox_billing_target as RepoFixture["sandbox_billing_target"]) ||
          state.repo.sandbox_billing_target,
        sandbox_billing_mode_override:
          (payload.sandbox_billing_mode_override as
            | RepoFixture["sandbox_billing_mode_override"]
            | undefined) ?? null,
        env_sync_mode:
          (payload.env_sync_mode as RepoFixture["env_sync_mode"]) ||
          state.repo.env_sync_mode,
        root_directory:
          (payload.root_directory as string | null | undefined) ?? null,
        install_command:
          (payload.install_command as string | null | undefined) ?? null,
        dev_command: (payload.dev_command as string | null | undefined) ?? null,
        dev_port:
          (payload.dev_port as number | undefined) || state.repo.dev_port,
        dev_port_auto:
          (payload.dev_port_auto as boolean | undefined) ??
          state.repo.dev_port_auto,
        sandbox_timeout_ms:
          (payload.sandbox_timeout_ms as number | undefined) ||
          state.repo.sandbox_timeout_ms,
        sandbox_env_vars:
          (payload.sandbox_env_vars as
            | Record<string, string>
            | null
            | undefined) ?? state.repo.sandbox_env_vars,
        workspace: { ...state.workspace },
      };
      await fulfillJson(route, currentRepo());
      return;
    }

    await fulfillJson(route, [currentRepo()]);
  });
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
  await page.route(/\/api\/vercel\/targets(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      const payload = JSON.parse(route.request().postData() || "{}") as {
        name?: string;
        teamId?: string;
      };
      const normalizedTeamId =
        payload.teamId && payload.teamId !== "personal"
          ? payload.teamId
          : "personal";
      const slug = (payload.name || "new-project")
        .trim()
        .toLowerCase()
        .replace(/[^\da-z]+/g, "-");
      const project = {
        id: `created-${normalizedTeamId}-${slug}`,
        name: payload.name || "New Project",
        framework: "nextjs",
      };
      const existing = state.projectsByTeam[normalizedTeamId] || [];
      state.projectsByTeam[normalizedTeamId] = [
        ...existing.filter((item) => item.id !== project.id),
        project,
      ].sort((a, b) => a.name.localeCompare(b.name));
      await fulfillJson(route, { project, teamId: normalizedTeamId });
      return;
    }

    if (state.targetsError) {
      const status = state.targetsError === "VERCEL_AUTH_INVALID" ? 401 : 400;
      await fulfillJson(route, { error: state.targetsError }, status);
      return;
    }

    const requestUrl = new URL(route.request().url());
    const teamId = requestUrl.searchParams.get("teamId") || "personal";
    const validationProjectId = requestUrl.searchParams.get(
      "validationProjectId"
    );
    const validationTeamId =
      requestUrl.searchParams.get("validationTeamId") || teamId;
    const validationCode = validationProjectId
      ? state.validationErrorsByProjectId[validationProjectId] ||
        ((state.projectsByTeam[validationTeamId] || []).some(
          (project) => project.id === validationProjectId
        )
          ? undefined
          : "PROJECT_NOT_FOUND")
      : undefined;
    await fulfillJson(route, {
      teams: state.teams,
      projects: state.projectsByTeam[teamId] || [],
      defaultTeamId: "personal",
      validation: validationProjectId
        ? validationCode
          ? { ok: false, code: validationCode }
          : { ok: true }
        : null,
    });
  });
}

async function installObservabilityMocks(page: Page) {
  const call = buildSandboxBackedCall({
    repoId: "repo-1",
    sandboxRecordId: "sandbox-record-1",
    sandboxId: "sandbox-runtime-1",
    previewUrl: "https://preview.mogplex.test",
    computeBillingSource: "user_vercel_project",
    billingProjectId: "proj_user_123",
    billingTeamId: "team-acme",
    aiBillingSource: "user_ai_gateway",
  });

  await page.route("**/api/observability/stats", (route) =>
    fulfillJson(route, buildObservabilitySummary([call]))
  );
  await page.route(/\/api\/observability\/jobs(?:\?.*)?$/, (route) =>
    fulfillJson(route, { jobs: [], total: 0, page: 1, limit: 25 })
  );
  await page.route(
    /\/api\/observability\/automation-events(?:\?.*)?$/,
    (route) => fulfillJson(route, { events: [], total: 0, page: 1, limit: 25 })
  );
  await page.route(/\/api\/observability\/calls(?:\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    const liveOnly = url.searchParams.get("live_only") === "true";
    return fulfillJson(route, {
      calls: [call],
      total: 1,
      page: 1,
      limit: liveOnly ? 100 : 50,
    });
  });
  await page.route(/\/api\/observability\/call-events(?:\?.*)?$/, (route) =>
    fulfillJson(route, { events: [] })
  );
}

test("workspace user billing persists after creating a linked Vercel project", async ({
  page,
}) => {
  const state = createBillingState();
  await installBaseMocks(page, state);

  await page.goto("/projects/repositories");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByText("Rename project").click();

  await page
    .getByRole("combobox", { name: "Default Sandbox Billing" })
    .selectOption("user_vercel_project");
  await page
    .getByRole("combobox", { name: "Workspace Vercel Team" })
    .selectOption("team-acme");

  const createdProjectId = "created-team-acme-core";
  await page.getByRole("button", { name: "Create core" }).click();
  await expect(
    page.getByRole("combobox", { name: "Workspace Vercel Project" })
  ).toHaveValue(createdProjectId);

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();

  expect(state.workspacePatchBodies.at(-1)).toMatchObject({
    sandbox_billing_mode: "user_vercel_project",
    sandbox_vercel_team_id: "team-acme",
    sandbox_vercel_project_id: createdProjectId,
  });

  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByText("Rename project").click();

  await expect(
    page.getByRole("combobox", { name: "Default Sandbox Billing" })
  ).toHaveValue("user_vercel_project");
  await expect(
    page.getByRole("combobox", { name: "Workspace Vercel Team" })
  ).toHaveValue("team-acme");
  await expect(
    page.getByRole("combobox", { name: "Workspace Vercel Project" })
  ).toHaveValue(createdProjectId);
  await expect(
    page.getByText("Effective owner: Your Vercel project.")
  ).toBeVisible();
});

test("repo project pinning persists inherited workspace team and can be cleared back to personal", async ({
  page,
}) => {
  const state = createBillingState({
    workspace: {
      sandbox_billing_mode: "user_vercel_project",
      sandbox_vercel_team_id: "team-acme",
      sandbox_vercel_project_id: "workspace-app",
    },
  });
  await installBaseMocks(page, state);

  await page.goto("/projects/repositories");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Repo actions" }).click();
  await page.getByText("Space Settings").click();

  await expect(
    page.getByText("Effective owner: Your Vercel project.")
  ).toBeVisible();
  await expect(
    page.getByText("Current effective project: workspace-app.")
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Repo-linked Vercel Team" })
  ).toHaveValue("__workspace__");

  await page
    .getByRole("combobox", { name: "Repo-linked Vercel Project" })
    .selectOption("repo-app");
  await page.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("Space Settings")).not.toBeVisible();

  expect(state.repoPatchBodies.at(-1)).toMatchObject({
    sandbox_billing_mode_override: null,
    sandbox_billing_target: "team",
    vercel_team_id: "team-acme",
    vercel_project_id: "repo-app",
  });

  await page.getByRole("button", { name: "Repo actions" }).click();
  await page.getByText("Space Settings").click();

  await page
    .getByRole("combobox", { name: "Sandbox Billing" })
    .selectOption("platform");
  await expect(
    page.getByText("Effective owner: Mogplex platform project.")
  ).toBeVisible();

  await page
    .getByRole("combobox", { name: "Sandbox Billing" })
    .selectOption("user_vercel_project");
  await page
    .getByRole("combobox", { name: "Repo-linked Vercel Team" })
    .selectOption("personal");
  await page
    .getByRole("combobox", { name: "Repo-linked Vercel Project" })
    .selectOption("");
  await page.getByRole("button", { name: "Save Settings" }).click();

  expect(state.repoPatchBodies.at(-1)).toMatchObject({
    sandbox_billing_mode_override: "user_vercel_project",
    sandbox_billing_target: "personal",
    vercel_team_id: null,
    vercel_project_id: null,
  });
});

test("workspace and repo settings warn when user billing has no linked Vercel project", async ({
  page,
}) => {
  const state = createBillingState();
  await installBaseMocks(page, state);

  await page.goto("/projects/repositories");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByText("Rename project").click();

  await page
    .getByRole("combobox", { name: "Default Sandbox Billing" })
    .selectOption("user_vercel_project");
  await expect(
    page.getByText(
      "Select or create a workspace-linked Vercel project to keep user-billed sandbox launch working."
    )
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Repo actions" }).click();
  await page.getByText("Space Settings").click();

  await page
    .getByRole("combobox", { name: "Sandbox Billing" })
    .selectOption("user_vercel_project");
  await expect(
    page.getByText(
      "Select or create a repo-linked Vercel project to keep user-billed sandbox launch working."
    )
  ).toBeVisible();
});

test("workspace and repo settings show reachable linked-project validation and reconnect actions", async ({
  page,
}) => {
  const state = createBillingState({
    workspace: {
      sandbox_billing_mode: "user_vercel_project",
      sandbox_vercel_team_id: "team-acme",
      sandbox_vercel_project_id: "workspace-app",
    },
  });
  await installBaseMocks(page, state);

  await page.goto("/projects/repositories");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByText("Rename project").click();
  await expect(
    page.getByText(
      "workspace-linked Vercel project is reachable and ready for user-billed sandbox launch."
    )
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Repo actions" }).click();
  await page.getByText("Space Settings").click();
  await expect(
    page.getByText(
      "workspace-linked Vercel project is reachable and ready for user-billed sandbox launch."
    )
  ).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  state.targetsError = "VERCEL_AUTH_INVALID";

  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByText("Rename project").click();
  await expect(
    page.getByText(
      "Reconnect Personal Vercel to restore access to the linked billing project."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Reconnect Personal Vercel" })
  ).toBeVisible();
});

test("observability surfaces sandbox compute and AI billing details", async ({
  page,
}) => {
  const state = createBillingState({
    workspace: {
      sandbox_billing_mode: "user_vercel_project",
      sandbox_vercel_team_id: "team-acme",
      sandbox_vercel_project_id: "workspace-app",
    },
  });
  await installBaseMocks(page, state);
  await installObservabilityMocks(page);

  await page.goto("/observability");
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("heading", { name: "Observability" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live Runs" })).toBeVisible();
  await expect(page.getByText("user billing").first()).toBeVisible();

  const callsSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Calls" }) });
  await callsSection.locator("tbody tr").first().click();

  await expect(callsSection.getByText("Sandbox Billing")).toBeVisible();
  await expect(callsSection.getByText("Compute Billing")).toBeVisible();
  await expect(callsSection.getByText("AI Billing Source")).toBeVisible();
  await expect(callsSection.getByText("user ai gateway")).toBeVisible();
  await expect(callsSection.getByText("proj_user_123")).toBeVisible();
  await expect(callsSection.getByText("team-acme")).toBeVisible();
  await expect(
    callsSection.getByText("sandbox-record-1", { exact: true })
  ).toBeVisible();
  await expect(
    callsSection.getByText("sandbox-runtime-1", { exact: true })
  ).toBeVisible();
});
