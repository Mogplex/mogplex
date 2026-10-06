import { describe, expect, it } from "vitest";
import { hasConfiguredSandboxEnv } from "../repo-settings";
import { resolveSandboxBilling } from "../sandbox/billing";
import { getRepoLinkedVercelProject, resolveRepoSandboxEnv } from "./env-vars";
import {
  resolveBillingLinkedProjectSelection,
  resolveEnvSyncLinkedProjectSelection,
  resolveRepoEnvVarAccess,
} from "./target-resolution";

describe("retired personal Vercel preferences", () => {
  const legacyBilling = {
    workspaceBillingModeInput: "user_vercel_project",
    repoBillingModeOverrideInput: "user_vercel_project",
    repoLinkedProjectId: "prj_repo",
    repoLinkedTeamId: "team_repo",
    workspaceLinkedProjectId: "prj_workspace",
    workspaceLinkedTeamId: "team_workspace",
    accountLinkedProjectId: "prj_account",
    accountLinkedTeamId: "team_account",
  };

  it("launches with platform billing despite saved personal targets at every scope", () => {
    expect(resolveSandboxBilling(legacyBilling)).toEqual({
      ok: true,
      billingSource: "platform",
      projectId: null,
      teamId: null,
      sourceScope: "platform",
    });
    expect(resolveBillingLinkedProjectSelection(legacyBilling)).toEqual({
      billingMode: "platform",
      source: null,
      projectId: null,
      teamId: null,
    });
  });

  it("does not treat a saved project as configured sandbox environment variables", async () => {
    const repo = {
      env_sync_mode: "vercel-project",
      vercel_project_id: "prj_legacy",
      vercel_team_id: "team_legacy",
    };
    expect(hasConfiguredSandboxEnv(repo)).toBe(false);
    expect(getRepoLinkedVercelProject(repo)).toBeNull();
    expect(
      resolveEnvSyncLinkedProjectSelection({
        envSyncModeInput: repo.env_sync_mode,
        repoLinkedProjectId: repo.vercel_project_id,
        repoLinkedTeamId: repo.vercel_team_id,
      })
    ).toEqual({
      envSyncMode: "sandbox-only",
      source: null,
      projectId: null,
      teamId: null,
    });
    expect(await resolveRepoSandboxEnv({ repo, userId: "user-1" })).toEqual({
      envVars: {},
      sync: { mode: "sandbox-only", source: "manual", warning: null },
    });
    const configuredRepo = { ...repo, sandbox_env_vars: { FEATURE: "on" } };
    expect(hasConfiguredSandboxEnv(configuredRepo)).toBe(true);
    expect(
      (await resolveRepoSandboxEnv({ repo: configuredRepo, userId: "user-1" }))
        .envVars
    ).toEqual({ FEATURE: "on" });
  });

  it.each(["vercel-project", "sandbox-only"])(
    "rejects provider env access even with legacy credentials in %s mode",
    (envSyncModeInput) => {
      expect(
        resolveRepoEnvVarAccess({
          ...legacyBilling,
          envSyncModeInput,
          personalVercelToken: "fixture-legacy-token",
        })
      ).toMatchObject({
        ok: false,
        status: 501,
        error: "VERCEL_INTEGRATION_REQUIRED",
      });
    }
  );
});
