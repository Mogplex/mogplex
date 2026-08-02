import assert from "node:assert/strict";
import test from "node:test";
import type { SandboxRecord } from "@/lib/types";
import type { SandboxBillingMode } from "@/lib/sandbox/billing";
import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";

async function loadSandboxStore() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../hooks/use-sandbox");
}

type SandboxRecordBuildOverrides = Partial<SandboxRecord> & {
  status?: SandboxRecord["runtime_summary"]["status"];
  health_status?: SandboxHealthStatus | null;
  preview_url?: string | null;
  last_health_check_at?: string | null;
  last_preview_http_status?: number | null;
  last_preview_error?: string | null;
  last_boot_error?: string | null;
  last_boot_started_at?: string | null;
  last_boot_completed_at?: string | null;
  boot_attempts?: number;
  error?: string | null;
  billing_source?: SandboxBillingMode | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
};

function buildSandboxRecord(
  overrides: SandboxRecordBuildOverrides = {}
): SandboxRecord {
  const status =
    overrides.status ?? overrides.runtime_summary?.status ?? "creating";
  const healthStatus =
    overrides.health_status ??
    overrides.runtime_summary?.health_status ??
    "starting";
  const previewUrl =
    overrides.preview_url ?? overrides.runtime_summary?.preview_url ?? null;
  const lastPreviewError =
    overrides.last_preview_error ??
    overrides.error_summary?.last_preview_error ??
    null;
  const lastBootError =
    overrides.last_boot_error ??
    overrides.error_summary?.last_boot_error ??
    null;
  const currentError =
    overrides.error ?? overrides.error_summary?.current_error ?? null;
  const lastHealthCheckAt =
    overrides.last_health_check_at ??
    overrides.runtime_summary?.last_health_check_at ??
    null;
  const lastPreviewHttpStatus =
    overrides.last_preview_http_status ??
    overrides.runtime_summary?.last_preview_http_status ??
    null;
  const bootAttempts =
    overrides.boot_attempts ?? overrides.runtime_summary?.boot_attempts ?? 1;
  const lastBootStartedAt =
    overrides.last_boot_started_at ??
    overrides.runtime_summary?.last_boot_started_at ??
    null;
  const lastBootCompletedAt =
    overrides.last_boot_completed_at ??
    overrides.runtime_summary?.last_boot_completed_at ??
    null;
  const billingSource =
    overrides.billing_source ?? overrides.billing_summary?.source ?? "platform";
  const billingTeamId =
    overrides.billing_team_id ?? overrides.billing_summary?.team_id ?? null;
  const billingProjectId =
    overrides.billing_project_id ??
    overrides.billing_summary?.project_id ??
    "project-1";

  return {
    id: overrides.id ?? "sandbox-1",
    user_id: overrides.user_id ?? "user-1",
    repo_id: overrides.repo_id ?? "repo-1",
    sandbox_id: overrides.sandbox_id ?? "pending",
    base_branch: overrides.base_branch ?? "main",
    working_branch: overrides.working_branch ?? overrides.base_branch ?? "main",
    snapshot_id: overrides.snapshot_id ?? null,
    stop_reason: overrides.stop_reason ?? null,
    install_log: overrides.install_log ?? null,
    dev_log: overrides.dev_log ?? null,
    runtime: overrides.runtime ?? "node22",
    terminal_cwd: overrides.terminal_cwd ?? null,
    // root_directory has three-way semantics on SandboxRecord (undefined =
    // "use repo default", null = "explicit repo root", string = subpath).
    // Default to null so launchKey round-trips render the "n" sentinel
    // instead of falling back to "u".
    root_directory:
      overrides.root_directory === undefined ? null : overrides.root_directory,
    created_at: overrides.created_at ?? "2026-04-01T10:00:00.000Z",
    last_active_at: overrides.last_active_at ?? "2026-04-01T10:00:00.000Z",
    billing_summary: overrides.billing_summary ?? {
      source: billingSource,
      label:
        billingSource === "user_vercel_project"
          ? "Your Vercel project"
          : "Mogplex billing",
      project_id: billingProjectId,
      team_id: billingTeamId,
      team_label: billingTeamId ?? "Personal",
    },
    runtime_summary: overrides.runtime_summary ?? {
      sandbox_id: overrides.sandbox_id ?? "pending",
      status,
      health_status: healthStatus,
      preview_url: previewUrl,
      last_health_check_at: lastHealthCheckAt,
      last_preview_http_status: lastPreviewHttpStatus,
      boot_attempts: bootAttempts,
      last_boot_started_at: lastBootStartedAt,
      last_boot_completed_at: lastBootCompletedAt,
    },
    error_summary: overrides.error_summary ?? {
      current_error: currentError,
      last_preview_error: lastPreviewError,
      last_boot_error: lastBootError,
      display_error: currentError ?? lastPreviewError ?? lastBootError,
      has_errors: Boolean(currentError ?? lastPreviewError ?? lastBootError),
    },
  };
}

function buildSseResponse(events: unknown[]) {
  const body = events
    .flatMap((event) => [`data: ${JSON.stringify(event)}`, ""])
    .join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

function createStoreHarness(repoId: string) {
  let state = {
    sandboxes: {} as Record<string, SandboxRecord>,
    sandboxesById: {} as Record<string, SandboxRecord>,
    activeSandboxId: null as string | null,
    creating: new Set<string>([repoId]),
    errors: {} as Record<
      string,
      { message: string; code: string; launchAttemptId?: string }
    >,
    logs: {} as Record<string, string>,
    setSandboxRecord(record: SandboxRecord) {
      state = {
        ...state,
        sandboxes: {
          ...state.sandboxes,
          [record.repo_id]: record,
        },
        sandboxesById: {
          ...state.sandboxesById,
          [record.id]: record,
        },
        activeSandboxId: record.id,
      };
    },
    appendLog(targetRepoId: string, text: string) {
      state = {
        ...state,
        logs: {
          ...state.logs,
          [targetRepoId]: (state.logs[targetRepoId] || "") + text,
        },
      };
    },
  };

  const set = (
    partial:
      | Record<string, unknown>
      | ((current: typeof state) => Record<string, unknown>)
  ) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    state = {
      ...state,
      ...next,
    };
  };

  return {
    set,
    get: () => state,
  };
}

test("consumeSandboxLaunchResponse applies summary-backed launch events directly", async () => {
  const { buildSandboxStateKey, consumeSandboxLaunchResponse } =
    await loadSandboxStore();
  const repoId = "repo-1";
  const launchKey = buildSandboxStateKey(repoId, "main", null);
  const creatingSandbox = buildSandboxRecord();
  const installingSandbox = buildSandboxRecord({
    sandbox_id: "vm_123",
    status: "installing",
    health_status: "starting",
    runtime_summary: {
      ...creatingSandbox.runtime_summary,
      sandbox_id: "vm_123",
      status: "installing",
    },
  });
  const previewSandbox = buildSandboxRecord({
    sandbox_id: "vm_123",
    status: "installing",
    preview_url: "https://preview.example.com",
    health_status: "starting",
    runtime_summary: {
      ...installingSandbox.runtime_summary,
      preview_url: "https://preview.example.com",
    },
  });
  const readySandbox = buildSandboxRecord({
    sandbox_id: "vm_123",
    status: "running",
    preview_url: "https://preview.example.com",
    health_status: "running",
    last_preview_http_status: 200,
    runtime_summary: {
      ...previewSandbox.runtime_summary,
      status: "running",
      health_status: "running",
      last_preview_http_status: 200,
    },
  });

  const harness = createStoreHarness(repoId);
  const response = buildSseResponse([
    { type: "status", status: "creating", sandbox: creatingSandbox },
    {
      type: "sandbox_created",
      sandboxId: "vm_123",
      recordId: "sandbox-1",
      sandbox: installingSandbox,
    },
    {
      type: "preview_url",
      url: "https://preview.example.com",
      sandbox: previewSandbox,
    },
    { type: "ready", sandbox: readySandbox },
  ]);

  const result = await consumeSandboxLaunchResponse(
    repoId,
    launchKey,
    response,
    harness.set as never,
    harness.get as never
  );

  assert.equal(result?.id, "sandbox-1");
  assert.equal(result?.runtime_summary.status, "running");
  assert.equal(
    result?.runtime_summary.preview_url,
    "https://preview.example.com"
  );
  assert.equal(
    harness.get().sandboxes[repoId].runtime_summary.status,
    "running"
  );
  assert.equal(
    harness.get().sandboxes[repoId].runtime_summary.preview_url,
    "https://preview.example.com"
  );
  assert.equal(harness.get().activeSandboxId, "sandbox-1");
});

test("consumeSandboxLaunchResponse keeps summary-backed error state before returning null", async () => {
  const { buildSandboxStateKey, consumeSandboxLaunchResponse } =
    await loadSandboxStore();
  const repoId = "repo-1";
  const launchKey = buildSandboxStateKey(repoId, "main", null);
  const errorSandbox = buildSandboxRecord({
    sandbox_id: "vm_123",
    status: "error",
    health_status: "app_error",
    preview_url: "https://preview.example.com",
    last_preview_error: "Preview returned 500",
    error: "Bootstrap failed",
    runtime_summary: {
      sandbox_id: "vm_123",
      status: "error",
      health_status: "app_error",
      preview_url: "https://preview.example.com",
      last_health_check_at: null,
      last_preview_http_status: 500,
      boot_attempts: 1,
      last_boot_started_at: null,
      last_boot_completed_at: null,
    },
    error_summary: {
      current_error: "Bootstrap failed",
      last_preview_error: "Preview returned 500",
      last_boot_error: null,
      display_error: "Bootstrap failed",
      has_errors: true,
    },
  });

  const harness = createStoreHarness(repoId);
  const response = buildSseResponse([
    { type: "status", status: "error", sandbox: errorSandbox },
    { type: "error", message: "Bootstrap failed", phase: "bootstrap" },
  ]);

  const result = await consumeSandboxLaunchResponse(
    repoId,
    launchKey,
    response,
    harness.set as never,
    harness.get as never,
    "launch-attempt-1"
  );

  assert.equal(result, null);
  assert.equal(harness.get().sandboxes[repoId].runtime_summary.status, "error");
  assert.equal(
    harness.get().sandboxes[repoId].error_summary.current_error,
    "Bootstrap failed"
  );
  assert.deepEqual(harness.get().errors[launchKey], {
    message: "Bootstrap failed",
    code: "UNKNOWN",
    launchAttemptId: "launch-attempt-1",
  });
});

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
