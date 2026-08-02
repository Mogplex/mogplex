import assert from "node:assert/strict";
import test from "node:test";
import {
  presentGithubSetup,
  presentProjectsEmptyState,
  presentRepoSyncFailure,
} from "../../lib/activation/setup-state";

test("presentGithubSetup derives install-pending copy and action", () => {
  const setup = presentGithubSetup({
    github_connected: false,
    github_app_available: true,
    github_state: "app_install_pending",
  });

  assert.equal(setup.state, "app_install_pending");
  assert.equal(setup.connectLabel, "Install GitHub App");
  assert.equal(setup.isConnectionReady, false);
  assert.equal(setup.canSyncRepos, false);
  assert.deepEqual(setup.primaryAction, {
    kind: "complete_install",
    label: "Complete GitHub App install",
    href: "/api/auth/github",
  });
});

test("presentGithubSetup keeps repo sync available for oauth-connected install-pending users", () => {
  const setup = presentGithubSetup({
    github_connected: true,
    github_app_available: true,
    github_state: "app_install_pending",
  });

  assert.equal(setup.state, "app_install_pending");
  assert.equal(setup.isConnectionReady, false);
  assert.equal(setup.canSyncRepos, true);
  assert.deepEqual(setup.primaryAction, {
    kind: "complete_install",
    label: "Complete GitHub App install",
    href: "/api/auth/github",
  });
});

test("presentGithubSetup falls back to disconnected OAuth copy", () => {
  const setup = presentGithubSetup({
    github_connected: false,
    github_app_available: false,
  });

  assert.equal(setup.state, "disconnected");
  assert.equal(setup.connectLabel, "Connect GitHub");
  assert.equal(setup.label, "Connect GitHub");
  assert.equal(setup.isConnectionReady, false);
  assert.equal(setup.canSyncRepos, false);
  assert.deepEqual(setup.primaryAction, {
    kind: "connect",
    label: "Connect GitHub",
    href: "/api/auth/github",
  });
});

test("presentProjectsEmptyState matches install-pending and connected states", () => {
  const installPending = presentProjectsEmptyState(
    presentGithubSetup({
      github_connected: false,
      github_app_available: true,
      github_state: "app_install_pending",
    })
  );
  const oauthOnly = presentProjectsEmptyState(
    presentGithubSetup({
      github_connected: true,
      github_app_available: false,
      github_state: "oauth_connected",
    })
  );
  const oauthInstallPending = presentProjectsEmptyState(
    presentGithubSetup({
      github_connected: true,
      github_app_available: true,
      github_state: "app_install_pending",
    })
  );

  assert.match(installPending.title, /Finish the GitHub App install/);
  assert.match(oauthOnly.title, /GitHub is connected/);
  assert.match(oauthInstallPending.title, /Import repos now/);
});

test("presentRepoSyncFailure distinguishes missing connection from generic failures", () => {
  assert.equal(
    presentRepoSyncFailure("NO_GITHUB_CONNECTION", "Install GitHub App"),
    "Install GitHub App to sync repos."
  );
  assert.equal(
    presentRepoSyncFailure("UNKNOWN", "Connect GitHub"),
    "GitHub repo sync failed. Retry sync."
  );
});
