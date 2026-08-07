import assert from "node:assert/strict";
import test from "node:test";
import {
  loadSandboxStore,
  buildSandboxRecord,
} from "./helpers/sandbox-launch-response-fixtures";

test("sandbox launch state keys round-trip explicit default values and root variants", async () => {
  const { buildSandboxStateKey, parseSandboxStateKey } =
    await loadSandboxStore();
  const repoId = "repo-1";

  const omittedRootKey = buildSandboxStateKey(repoId, "main");
  assert.deepEqual(parseSandboxStateKey(repoId, omittedRootKey), {
    workingBranch: "main",
    rootDirectory: undefined,
  });

  const rootKey = buildSandboxStateKey(repoId, "main", null);
  assert.deepEqual(parseSandboxStateKey(repoId, rootKey), {
    workingBranch: "main",
    rootDirectory: null,
  });
  assert.notEqual(omittedRootKey, rootKey);

  const defaultValueKey = buildSandboxStateKey(repoId, "default", "default");
  assert.deepEqual(parseSandboxStateKey(repoId, defaultValueKey), {
    workingBranch: "default",
    rootDirectory: "default",
  });
  assert.notEqual(defaultValueKey, buildSandboxStateKey(repoId));

  const literalRootKey = buildSandboxStateKey(repoId, "main", "root");
  assert.deepEqual(parseSandboxStateKey(repoId, literalRootKey), {
    workingBranch: "main",
    rootDirectory: "root",
  });
  const literalRootScope = parseSandboxStateKey(repoId, literalRootKey);
  assert.equal(
    buildSandboxStateKey(
      repoId,
      literalRootScope.workingBranch,
      literalRootScope.rootDirectory
    ),
    literalRootKey
  );
  assert.notEqual(literalRootKey, rootKey);
  assert.notEqual(literalRootKey, buildSandboxStateKey(repoId, "main"));
});

test("sandbox launch state keys ignore malformed encoded legacy segments", async () => {
  const { parseSandboxStateKey } = await loadSandboxStore();

  assert.deepEqual(parseSandboxStateKey("repo-1", "repo-1:%E0%A4%A:v-%"), {
    workingBranch: undefined,
    rootDirectory: undefined,
  });
});

test("sandbox launch state keys parse legacy two-segment launch keys", async () => {
  const { parseSandboxStateKey } = await loadSandboxStore();

  assert.deepEqual(parseSandboxStateKey("repo-1", "repo-1:main"), {
    workingBranch: "main",
    rootDirectory: undefined,
  });
  assert.deepEqual(parseSandboxStateKey("repo-1", "repo-1:v-main:root"), {
    workingBranch: "main",
    rootDirectory: null,
  });
  assert.deepEqual(parseSandboxStateKey("repo-1", "repo-1:default"), {
    workingBranch: undefined,
    rootDirectory: undefined,
  });
});

test("launch failures are tagged with unique attempt ids per scoped key", async () => {
  const { useSandboxStore } = await loadSandboxStore();
  const repoId = "repo-1";
  const launchRequest = {
    repoId,
    baseBranch: "main",
    workingBranch: "feature/attempt",
    createBranch: false,
    rootDirectory: null,
  };
  const initialState = useSandboxStore.getState();
  const originalFetch = globalThis.fetch;
  let failureIndex = 0;

  globalThis.fetch = (async () => {
    failureIndex += 1;
    return Response.json(
      { error: `Launch failed ${failureIndex}` },
      { status: 500 }
    );
  }) as typeof fetch;

  useSandboxStore.setState({
    creating: new Set(),
    creatingCounts: {},
    errors: {},
    logs: {},
  });

  try {
    await useSandboxStore.getState().launch(repoId, launchRequest);
    const firstError = useSandboxStore
      .getState()
      .getLaunchError(repoId, { workingBranch: "feature/attempt" });

    assert.equal(firstError?.message, "Launch failed 1");
    assert.match(firstError?.launchAttemptId ?? "", /^launch-/);

    await useSandboxStore.getState().launch(repoId, launchRequest);
    const secondError = useSandboxStore
      .getState()
      .getLaunchError(repoId, { workingBranch: "feature/attempt" });

    assert.equal(secondError?.message, "Launch failed 2");
    assert.match(secondError?.launchAttemptId ?? "", /^launch-/);
    assert.notEqual(secondError?.launchAttemptId, firstError?.launchAttemptId);
  } finally {
    globalThis.fetch = originalFetch;
    useSandboxStore.setState({
      creating: initialState.creating,
      creatingCounts: initialState.creatingCounts,
      errors: initialState.errors,
      logs: initialState.logs,
    });
  }
});

test("sandbox-scoped launch state ignores stale generic repo state", async () => {
  const { buildSandboxStateKey, useSandboxStore } = await loadSandboxStore();
  const repoId = "repo-1";
  const genericLaunchKey = buildSandboxStateKey(repoId);
  const scopedLaunchKey = buildSandboxStateKey(repoId, "main", null);
  const staleGenericError = {
    message: "Dev server launch (pnpm dev) timed out after 120s",
    code: "UNKNOWN" as const,
    launchAttemptId: "launch-stale",
  };
  const staleGenericLog = "old generic boot log\n";
  const scopedError = {
    message: "Scoped install failed",
    code: "UNKNOWN" as const,
    launchAttemptId: "launch-current",
  };
  const scopedLog = "current scoped boot log\n";
  const installingSandbox = buildSandboxRecord({
    id: "sandbox-installing",
    repo_id: repoId,
    sandbox_id: "vm_123",
    working_branch: "main",
    root_directory: null,
    status: "installing",
  });

  const initialState = useSandboxStore.getState();
  useSandboxStore.setState({
    sandboxes: {},
    sandboxesById: {},
    sandboxIdsByRepoId: {},
    activeSandboxId: null,
    creating: new Set(),
    creatingCounts: {},
    errors: { [genericLaunchKey]: staleGenericError },
    logs: { [genericLaunchKey]: staleGenericLog },
  });
  useSandboxStore.getState().setSandboxRecord(installingSandbox);

  try {
    const state = useSandboxStore.getState();

    assert.equal(
      state.getLaunchError(repoId, { sandboxId: "sandbox-installing" }),
      null
    );
    assert.deepEqual(state.getLaunchError(repoId), staleGenericError);
    assert.equal(
      state.getLaunchLogs(repoId, { sandboxId: "sandbox-installing" }),
      ""
    );
    assert.equal(state.getLaunchLogs(repoId), staleGenericLog);

    useSandboxStore.setState({
      errors: {
        [genericLaunchKey]: staleGenericError,
        [scopedLaunchKey]: scopedError,
      },
      logs: {
        [genericLaunchKey]: staleGenericLog,
        [scopedLaunchKey]: scopedLog,
      },
    });
    assert.deepEqual(
      useSandboxStore
        .getState()
        .getLaunchError(repoId, { sandboxId: "sandbox-installing" }),
      scopedError
    );
    assert.equal(
      useSandboxStore
        .getState()
        .getLaunchLogs(repoId, { sandboxId: "sandbox-installing" }),
      scopedLog
    );
  } finally {
    useSandboxStore.setState({
      sandboxes: initialState.sandboxes,
      sandboxesById: initialState.sandboxesById,
      sandboxIdsByRepoId: initialState.sandboxIdsByRepoId,
      activeSandboxId: initialState.activeSandboxId,
      creating: initialState.creating,
      creatingCounts: initialState.creatingCounts,
      errors: initialState.errors,
      logs: initialState.logs,
    });
  }
});

test("branch-only launch state lookups match explicit rootDirectory variants", async () => {
  const { buildSandboxStateKey, useSandboxStore } = await loadSandboxStore();
  const repoId = "repo-1";
  const launchKey = buildSandboxStateKey(repoId, "feature/rooted", "apps/web");
  const initialState = useSandboxStore.getState();

  useSandboxStore.setState({
    creating: new Set([launchKey]),
    creatingCounts: { [launchKey]: 1 },
    errors: {
      [launchKey]: { message: "Install failed", code: "UNKNOWN" },
    },
    logs: {
      [launchKey]: "installing...\n",
    },
  });

  try {
    const state = useSandboxStore.getState();
    const branchScope = { workingBranch: "feature/rooted" };

    assert.equal(state.isCreating(repoId, branchScope), true);
    assert.deepEqual(state.getLaunchError(repoId, branchScope), {
      message: "Install failed",
      code: "UNKNOWN",
    });
    assert.equal(state.getLaunchLogs(repoId, branchScope), "installing...\n");
  } finally {
    useSandboxStore.setState({
      creating: initialState.creating,
      creatingCounts: initialState.creatingCounts,
      errors: initialState.errors,
      logs: initialState.logs,
    });
  }
});

test("branch-only launch state lookups treat rootDirectory undefined as absent", async () => {
  const { buildSandboxStateKey, useSandboxStore } = await loadSandboxStore();
  const repoId = "repo-1";
  const launchKey = buildSandboxStateKey(repoId, "feature/rooted", "apps/web");
  const initialState = useSandboxStore.getState();

  useSandboxStore.setState({
    creating: new Set([launchKey]),
    creatingCounts: { [launchKey]: 1 },
    errors: {
      [launchKey]: { message: "Install failed", code: "UNKNOWN" },
    },
    logs: {
      [launchKey]: "installing...\n",
    },
  });

  try {
    const state = useSandboxStore.getState();
    const spreadScope = {
      workingBranch: "feature/rooted",
      rootDirectory: undefined,
    };

    assert.equal(state.isCreating(repoId, spreadScope), true);
    assert.deepEqual(state.getLaunchError(repoId, spreadScope), {
      message: "Install failed",
      code: "UNKNOWN",
    });
    assert.equal(state.getLaunchLogs(repoId, spreadScope), "installing...\n");
  } finally {
    useSandboxStore.setState({
      creating: initialState.creating,
      creatingCounts: initialState.creatingCounts,
      errors: initialState.errors,
      logs: initialState.logs,
    });
  }
});
