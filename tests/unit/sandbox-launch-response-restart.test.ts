import assert from "node:assert/strict";
import test from "node:test";
import {
  loadSandboxStore,
  buildSandboxRecord,
} from "./helpers/sandbox-launch-response-fixtures";

test("stop fallback publishes a manual stop reason", async () => {
  const { useSandboxStore } = await loadSandboxStore();
  const record = buildSandboxRecord({
    id: "sandbox-running",
    repo_id: "repo-1",
    sandbox_id: "vm-running",
    status: "running",
    health_status: "running",
  });
  const initialState = useSandboxStore.getState();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(input.toString(), "/api/sandbox/sandbox-running/stop");
    return Response.json({});
  }) as typeof fetch;

  useSandboxStore.setState({
    sandboxes: {},
    sandboxesById: {},
    sandboxIdsByRepoId: {},
    activeSandboxId: null,
  });
  useSandboxStore.getState().setSandboxRecord(record);

  try {
    await useSandboxStore.getState().stop(record.id);

    const stopped = useSandboxStore.getState().sandboxesById[record.id];
    assert.equal(stopped?.runtime_summary.status, "stopped");
    assert.equal(stopped?.stop_reason, "manual");
    assert.equal(useSandboxStore.getState().activeSandboxId, record.id);
  } finally {
    globalThis.fetch = originalFetch;
    useSandboxStore.setState({
      sandboxes: initialState.sandboxes,
      sandboxesById: initialState.sandboxesById,
      sandboxIdsByRepoId: initialState.sandboxIdsByRepoId,
      activeSandboxId: initialState.activeSandboxId,
    });
  }
});

test("restart treats 409 'still booting' as a transient retry signal, not a launch error", async () => {
  // /api/sandbox/[id]/restart returns 409 when sandbox_id is still "pending"
  // (the original launch hasn't finished). The store must not stamp that as a
  // launch error — the launch usually completes seconds later, and a stored
  // error pins a "Sandbox launch failed" overlay over the working preview.
  const { useSandboxStore } = await loadSandboxStore();
  const repoId = "repo-1";
  const seeded = buildSandboxRecord({
    id: "sandbox-pending",
    repo_id: repoId,
    sandbox_id: "pending",
    working_branch: "main",
    root_directory: null,
    status: "creating",
  });

  const initialState = useSandboxStore.getState();
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(url, "/api/sandbox/sandbox-pending/restart");
    return Response.json(
      { error: "Sandbox is still booting" },
      { status: 409 }
    );
  }) as typeof fetch;

  useSandboxStore.setState({
    sandboxes: {},
    sandboxesById: {},
    sandboxIdsByRepoId: {},
    activeSandboxId: null,
    creating: new Set(),
    creatingCounts: {},
    errors: {},
    logs: {},
  });
  useSandboxStore.getState().setSandboxRecord(seeded);

  try {
    const result = await useSandboxStore
      .getState()
      .restart(repoId, { sandboxId: "sandbox-pending" });

    assert.equal(calls, 1);
    // No error should be recorded — the launch is still in progress, not failed.
    assert.deepEqual(useSandboxStore.getState().errors, {});
    // restart returns the existing record so the caller can keep its binding.
    assert.equal(result?.id, "sandbox-pending");
    // The creating counter must be released even on the early-return path.
    assert.deepEqual(useSandboxStore.getState().creatingCounts, {});
  } finally {
    globalThis.fetch = originalFetch;
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

test("restart 409 preserves a prior actionable error stored at the same launchKey", async () => {
  // Regression guard for PR #533 review feedback: restart() used to clear
  // errors[launchKey] before the fetch, so a 409 early-return would silently
  // discard an actionable error from a prior failed attempt at the same key.
  const { buildSandboxStateKey, useSandboxStore } = await loadSandboxStore();
  const repoId = "repo-1";
  const seeded = buildSandboxRecord({
    id: "sandbox-pending",
    repo_id: repoId,
    sandbox_id: "pending",
    working_branch: "main",
    root_directory: null,
    status: "creating",
  });
  const launchKey = buildSandboxStateKey(repoId, "main", null);
  const priorError = {
    message:
      "Select or create a Vercel project for user-owned sandbox billing.",
    code: "VERCEL_PROJECT_REQUIRED" as const,
    launchAttemptId: "launch-prior",
  };

  const initialState = useSandboxStore.getState();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json(
      { error: "Sandbox is still booting" },
      { status: 409 }
    )) as typeof fetch;

  useSandboxStore.setState({
    sandboxes: {},
    sandboxesById: {},
    sandboxIdsByRepoId: {},
    activeSandboxId: null,
    creating: new Set(),
    creatingCounts: {},
    errors: { [launchKey]: priorError },
    logs: { [launchKey]: "prior log contents\n" },
  });
  useSandboxStore.getState().setSandboxRecord(seeded);

  try {
    await useSandboxStore
      .getState()
      .restart(repoId, { sandboxId: "sandbox-pending" });

    // Prior actionable error must survive the transient 409.
    assert.deepEqual(useSandboxStore.getState().errors[launchKey], priorError);
    // Log buffer must also be untouched on the early-return path.
    assert.equal(
      useSandboxStore.getState().logs[launchKey],
      "prior log contents\n"
    );
    // The creating counter must be released even when the 409 early-return
    // fires — guards against a future change that moves the increment below
    // the 409 guard or drops the finally-decrement.
    assert.deepEqual(useSandboxStore.getState().creatingCounts, {});
  } finally {
    globalThis.fetch = originalFetch;
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
