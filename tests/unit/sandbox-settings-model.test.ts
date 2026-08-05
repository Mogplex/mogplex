import assert from "node:assert/strict";
import test from "node:test";

import { INHERITED_WORKSPACE_TEAM_OPTION } from "../../lib/sandbox/billing";
import {
  buildRepoSandboxSettingsModel,
  buildRepoSandboxSettingsPayload,
  buildWorkspaceSandboxSettingsModel,
  buildWorkspaceSandboxSettingsPayload,
  createRepoSandboxSettingsDraft,
  createWorkspaceSandboxSettingsDraft,
  resolveRepoTeamSelectionDraft,
} from "../../lib/sandbox/settings-model";
import type { Repo, Workspace } from "../../lib/types";

function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws_123",
    user_id: "user_123",
    name: "Workspace",
    description: null,
    sandbox_billing_mode: "platform",
    sandbox_vercel_team_id: null,
    sandbox_vercel_project_id: null,
    created_at: "2026-03-31T00:00:00.000Z",
    updated_at: "2026-03-31T00:00:00.000Z",
    ...overrides,
  };
}

function createRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: "repo_123",
    user_id: "user_123",
    full_name: "acme/repo",
    name: "repo",
    workspace: createWorkspace(),
    created_at: "2026-03-31T00:00:00.000Z",
    ...overrides,
  };
}

test("workspace settings draft normalizes legacy user billing to platform", () => {
  const draft = createWorkspaceSandboxSettingsDraft(
    createWorkspace({
      sandbox_billing_mode: "user_vercel_project",
      sandbox_vercel_project_id: null,
    })
  );

  const model = buildWorkspaceSandboxSettingsModel(draft);

  assert.equal(model.teamScope, "personal");
  assert.equal(draft.billingMode, "platform");
  assert.equal(draft.vercelTeamId, "");
  assert.equal(draft.vercelProjectId, "");
  assert.equal(model.needsLinkedProject, false);
  assert.equal(model.effectiveOwnerLabel, "Mogplex platform project");
});

test("workspace settings payload normalizes empty Vercel target values to null", () => {
  assert.deepEqual(
    buildWorkspaceSandboxSettingsPayload({
      billingMode: "user_vercel_project",
      timeoutMs: 30 * 60 * 1000,
      idleTimeoutMs: 15 * 60 * 1000,
      vercelTeamId: "",
      vercelProjectId: "",
    }),
    {
      sandbox_billing_mode: "platform",
      sandbox_timeout_ms: 30 * 60 * 1000,
      sandbox_idle_timeout_ms: 15 * 60 * 1000,
      sandbox_vercel_team_id: null,
      sandbox_vercel_project_id: null,
    }
  );
});

test("workspace settings draft exposes default idle timeout when unset", () => {
  const draft = createWorkspaceSandboxSettingsDraft(createWorkspace());
  assert.equal(draft.idleTimeoutMs, 30 * 60 * 1000);
});

test("repo settings model ignores legacy workspace user billing", () => {
  const repo = createRepo({
    workspace: createWorkspace({
      sandbox_billing_mode: "user_vercel_project",
      sandbox_vercel_team_id: "team_workspace",
      sandbox_vercel_project_id: "prj_workspace",
    }),
  });

  const model = buildRepoSandboxSettingsModel(
    repo,
    createRepoSandboxSettingsDraft(repo),
    [
      { id: "personal", name: "Personal" },
      { id: "team_workspace", name: "Workspace Team" },
    ]
  );

  assert.equal(model.effectiveBillingMode, "platform");
  assert.equal(model.selectedTeamValue, "personal");
  assert.equal(model.teamScope, "personal");
  assert.equal(model.usingWorkspaceTeam, false);
  assert.equal(model.inheritedTeamName, "Workspace Team");
  assert.equal(model.needsLinkedProject, false);
});

test("repo save payload does not pin billing scope from a disabled legacy mode", () => {
  const repo = createRepo({
    workspace: createWorkspace({
      sandbox_billing_mode: "user_vercel_project",
      sandbox_vercel_team_id: "team_workspace",
      sandbox_vercel_project_id: "prj_workspace",
    }),
  });

  assert.deepEqual(
    buildRepoSandboxSettingsPayload(repo, {
      billingModeOverride: "inherit",
      vercelTeamId: "",
      vercelProjectId: "prj_repo",
    }),
    {
      sandbox_billing_target: "personal",
      sandbox_billing_mode_override: null,
      vercel_team_id: null,
      vercel_project_id: null,
    }
  );
});

test("repo team selection draft clears linked team and project when switching to personal or inherit", () => {
  assert.deepEqual(
    resolveRepoTeamSelectionDraft("personal", {
      billingModeOverride: "inherit",
      vercelTeamId: "team_123",
      vercelProjectId: "prj_123",
    }),
    {
      billingModeOverride: "inherit",
      vercelTeamId: "",
      vercelProjectId: "",
    }
  );

  assert.deepEqual(
    resolveRepoTeamSelectionDraft(INHERITED_WORKSPACE_TEAM_OPTION, {
      billingModeOverride: "platform",
      vercelTeamId: "team_123",
      vercelProjectId: "prj_123",
    }),
    {
      billingModeOverride: "platform",
      vercelTeamId: "",
      vercelProjectId: "",
    }
  );
});
