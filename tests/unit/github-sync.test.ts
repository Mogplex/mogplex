import assert from "node:assert/strict";
import test from "node:test";

async function loadGithubSync() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/github-sync");
}

test("rebindStaleAutomationInstallationBindingsForUser updates stale flows and triggers when one current installation remains", async () => {
  const { rebindStaleAutomationInstallationBindingsForUser } =
    await loadGithubSync();
  let flowCalls = 0;
  let triggerCalls = 0;

  const result = await rebindStaleAutomationInstallationBindingsForUser(
    "user-123",
    121640727,
    {
      loadCurrentInstallations: async (userId) => {
        assert.equal(userId, "user-123");
        return [{ installation_id: 121640727 }];
      },
      rebindFlows: async (userId, installationId) => {
        flowCalls += 1;
        assert.equal(userId, "user-123");
        assert.equal(installationId, 121640727);
        return 1;
      },
      rebindTriggers: async (userId, installationId) => {
        triggerCalls += 1;
        assert.equal(userId, "user-123");
        assert.equal(installationId, 121640727);
        return 2;
      },
    }
  );

  assert.deepEqual(result, {
    flowCount: 1,
    triggerCount: 2,
    skippedReason: "none",
  });
  assert.equal(flowCalls, 1);
  assert.equal(triggerCalls, 1);
});

test("rebindStaleAutomationInstallationBindingsForUser skips automatic migration when multiple installations are active", async () => {
  const { rebindStaleAutomationInstallationBindingsForUser } =
    await loadGithubSync();
  let flowCalls = 0;
  let triggerCalls = 0;

  const result = await rebindStaleAutomationInstallationBindingsForUser(
    "user-123",
    121640727,
    {
      loadCurrentInstallations: async () => [
        { installation_id: 121640727 },
        { installation_id: 117860437 },
      ],
      rebindFlows: async () => {
        flowCalls += 1;
        return 0;
      },
      rebindTriggers: async () => {
        triggerCalls += 1;
        return 0;
      },
    }
  );

  assert.deepEqual(result, {
    flowCount: 0,
    triggerCount: 0,
    skippedReason: "multiple_current_installations",
  });
  assert.equal(flowCalls, 0);
  assert.equal(triggerCalls, 0);
});

test("rebindStaleAutomationInstallationBindingsForUser skips automatic migration when the synced installation does not match the current binding", async () => {
  const { rebindStaleAutomationInstallationBindingsForUser } =
    await loadGithubSync();

  const result = await rebindStaleAutomationInstallationBindingsForUser(
    "user-123",
    121640727,
    {
      loadCurrentInstallations: async () => [{ installation_id: 999 }],
      rebindFlows: async () => {
        throw new Error("rebindFlows should not be called");
      },
      rebindTriggers: async () => {
        throw new Error("rebindTriggers should not be called");
      },
    }
  );

  assert.deepEqual(result, {
    flowCount: 0,
    triggerCount: 0,
    skippedReason: "current_installation_mismatch",
  });
});

test("filterVisibleGithubRepos prefers app-covered repos when installation-backed sync is active", async () => {
  const { filterVisibleGithubRepos } = await loadGithubSync();

  const visible = filterVisibleGithubRepos(
    [
      { id: "repo-covered", github_installation_id: 42, full_name: "acme/app" },
      {
        id: "repo-stale",
        github_installation_id: null,
        full_name: "alex/side-project",
      },
    ],
    { preferInstallationCoverage: true }
  );

  assert.deepEqual(visible, [
    { id: "repo-covered", github_installation_id: 42, full_name: "acme/app" },
  ]);
});

test("filterVisibleGithubRepos keeps synced-only repos visible until covered repos exist", async () => {
  const { filterVisibleGithubRepos } = await loadGithubSync();

  const repos = [
    {
      id: "repo-1",
      github_installation_id: null,
      full_name: "alex/side-project",
    },
    {
      id: "repo-2",
      github_installation_id: null,
      full_name: "alex/another-project",
    },
  ];

  assert.deepEqual(
    filterVisibleGithubRepos(repos, { preferInstallationCoverage: true }),
    repos
  );
  assert.deepEqual(
    filterVisibleGithubRepos(repos, { preferInstallationCoverage: false }),
    repos
  );
});
