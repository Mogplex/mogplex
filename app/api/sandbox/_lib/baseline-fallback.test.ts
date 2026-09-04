import { describe, expect, it, vi } from "vitest";
import {
  BASELINE_FALLBACK_CANCELLED_MESSAGE,
  fallbackFromBaselineToGit,
} from "./baseline-fallback";
import type { BaselineFallbackInput } from "./baseline-fallback";
import type { SandboxEvent } from "@/lib/sandbox/events";

const FRESH_NAME = "mogplex-user-1-repo-1-main-root";

function buildRecord(sandboxId: string) {
  return {
    id: "record-1",
    user_id: "user-1",
    repo_id: "repo-1",
    sandbox_id: sandboxId,
    base_branch: "main",
    working_branch: "main",
    limit_claim_id: null,
    status: "installing",
    preview_url: null,
    snapshot_id: null,
    error: null,
    created_at: "2026-09-04T21:41:42.000Z",
    last_active_at: "2026-09-04T21:41:42.000Z",
  };
}

function buildSandbox(name: string, calls: string[]) {
  return {
    name,
    persistent: false,
    stop: vi.fn(async () => {
      calls.push(`stop:${name}`);
    }),
  };
}

function buildScenario(
  options: {
    previousName?: string;
    repointSucceeds?: boolean;
    repointError?: Error;
    createBranch?: boolean;
  } = {}
) {
  const calls: string[] = [];
  const events: SandboxEvent[] = [];
  const previous = buildSandbox(options.previousName ?? "snapshot-vm", calls);
  const fresh = buildSandbox(FRESH_NAME, calls);

  const deps = {
    createSandboxForRepo: vi.fn(async (opts: { name?: string }) => {
      calls.push("create");
      // The provider honours the requested name; mirror that so the record
      // repoint is asserted against the name actually created.
      fresh.name = opts.name ?? fresh.name;
      return fresh;
    }),
    requireSandboxBillingSession: vi.fn(async () => {
      calls.push("billing");
    }),
    prepareSandboxBillingClose: vi.fn(async () => {}),
    startSandboxReadinessReconciliation: vi.fn(async () => ({
      queued: true as const,
      runtimeProvider: "trigger" as const,
      runtimeRunId: "run_1",
      reason: null,
    })),
  };

  const state = {
    sandbox: previous,
    previewUrl: null,
    restoredFromSnapshot: true,
    restoredFromBaselineSnapshot: true,
    shouldQueueDeferredSnapshot: false,
    streamSandboxRecord: buildRecord(previous.name),
  };

  const input = {
    state,
    deps,
    emit: (event: SandboxEvent) => {
      events.push(event);
    },
    environment: { envResolution: { envVars: {} }, networkPolicy: undefined },
    launch: {
      repoId: "repo-1",
      productTeamId: null,
      githubToken: "gh-token",
      cloneRevision: "main",
      runtime: "node22",
      configuredDevPort: 3000,
      effectiveSandboxTimeoutMs: 60_000,
      effectiveRootDirectory: null,
      sandboxNameOverride: FRESH_NAME,
      creds: { userId: "user-1" },
      repo: { id: "repo-1", full_name: "acme/app", snapshot_id: "snap_1" },
      launchRequest: {
        baseBranch: "main",
        workingBranch: "main",
        createBranch: options.createBranch ?? false,
      },
      createContext: {
        credentials: {
          vercelToken: "vercel-token",
          vercelTeamId: "team_1",
          vercelProjectId: "prj_1",
        },
      },
    },
  } as unknown as BaselineFallbackInput;

  const helpers = {
    updateSandboxRecord: vi.fn(async () => {
      calls.push("repoint");
      if (options.repointError) throw options.repointError;
      return options.repointSucceeds === false ? null : buildRecord(FRESH_NAME);
    }),
    clearRepoSnapshotIfCurrent: vi.fn(async () => {}),
    configureSandboxGitAccess: vi.fn(async () => {}),
    createWorkingBranchInSandbox: vi.fn(async () => {}),
  };

  return { calls, events, previous, fresh, deps, state, input, helpers };
}

describe("fallbackFromBaselineToGit", () => {
  it("should repoint the record at the fresh VM before stopping the snapshot VM", async () => {
    const scenario = buildScenario();

    const replaced = await fallbackFromBaselineToGit(
      scenario.input,
      scenario.helpers as never
    );

    expect(replaced).toBe(true);
    expect(scenario.deps.createSandboxForRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        name: FRESH_NAME,
        repoFullName: "acme/app",
        branch: "main",
        githubToken: "gh-token",
      })
    );
    expect(scenario.helpers.updateSandboxRecord).toHaveBeenCalledWith(
      "record-1",
      { sandbox_id: FRESH_NAME, persistent: false },
      expect.objectContaining({
        expectedSandboxId: "snapshot-vm",
        fromStatuses: ["creating", "installing"],
      })
    );
    expect(scenario.calls).toEqual([
      "create",
      "repoint",
      "stop:snapshot-vm",
      "billing",
    ]);
    expect(scenario.fresh.stop).not.toHaveBeenCalled();
    expect(scenario.state.sandbox).toBe(scenario.fresh);
    expect(scenario.state.streamSandboxRecord.sandbox_id).toBe(FRESH_NAME);
    expect(scenario.state.restoredFromSnapshot).toBe(false);
    expect(scenario.state.restoredFromBaselineSnapshot).toBe(false);
  });

  it("should clear the stale repo snapshot and re-queue readiness for the fresh VM", async () => {
    const scenario = buildScenario();

    await fallbackFromBaselineToGit(scenario.input, scenario.helpers as never);

    expect(scenario.helpers.clearRepoSnapshotIfCurrent).toHaveBeenCalledWith(
      "repo-1",
      "snap_1"
    );
    expect(
      scenario.deps.startSandboxReadinessReconciliation
    ).toHaveBeenCalledWith({
      sandboxRecordId: "record-1",
      expectedSandboxId: FRESH_NAME,
      source: "launch",
    });
    expect(scenario.deps.requireSandboxBillingSession).toHaveBeenCalledWith(
      "record-1",
      scenario.fresh
    );
    expect(scenario.helpers.configureSandboxGitAccess).toHaveBeenCalledWith({
      sandbox: scenario.fresh,
      githubToken: "gh-token",
      userId: "user-1",
    });
    expect(
      scenario.helpers.createWorkingBranchInSandbox
    ).not.toHaveBeenCalled();
    expect(scenario.events).toContainEqual(
      expect.objectContaining({
        type: "sandbox_created",
        sandboxId: FRESH_NAME,
        recordId: "record-1",
        sandbox: expect.objectContaining({ sandbox_id: FRESH_NAME }),
      })
    );
  });

  it("should create the working branch on the fresh VM when the launch asked for one", async () => {
    const scenario = buildScenario({ createBranch: true });

    await fallbackFromBaselineToGit(scenario.input, scenario.helpers as never);

    expect(scenario.helpers.createWorkingBranchInSandbox).toHaveBeenCalledWith(
      scenario.fresh,
      expect.objectContaining({
        workingBranch: "main",
        createBranch: true,
        rootDirectory: null,
      })
    );
  });

  it("should stop both VMs and report cancellation when the record moved on", async () => {
    const scenario = buildScenario({ repointSucceeds: false });

    const replaced = await fallbackFromBaselineToGit(
      scenario.input,
      scenario.helpers as never
    );

    expect(replaced).toBe(false);
    expect(scenario.fresh.stop).toHaveBeenCalledTimes(1);
    expect(scenario.previous.stop).toHaveBeenCalledTimes(1);
    expect(scenario.deps.requireSandboxBillingSession).not.toHaveBeenCalled();
    expect(
      scenario.deps.startSandboxReadinessReconciliation
    ).not.toHaveBeenCalled();
    expect(scenario.state.sandbox).toBe(scenario.previous);
    expect(scenario.events).toContainEqual({
      type: "error",
      message: BASELINE_FALLBACK_CANCELLED_MESSAGE,
      phase: "bootstrap",
    });
  });

  it("should stop the fresh VM and rethrow when the record repoint throws", async () => {
    const repointError = new Error("database unavailable");
    const scenario = buildScenario({ repointError });

    await expect(
      fallbackFromBaselineToGit(scenario.input, scenario.helpers as never)
    ).rejects.toBe(repointError);

    // The fresh VM is not yet `state.sandbox`, so the outer launch failure
    // handler would never stop it; the fallback must do so before rethrowing.
    expect(scenario.fresh.stop).toHaveBeenCalledTimes(1);
    // The previous VM is still `state.sandbox` and is the outer handler's job.
    expect(scenario.previous.stop).not.toHaveBeenCalled();
    expect(scenario.state.sandbox).toBe(scenario.previous);
    expect(scenario.state.streamSandboxRecord.sandbox_id).toBe("snapshot-vm");
    expect(scenario.deps.requireSandboxBillingSession).not.toHaveBeenCalled();
    expect(
      scenario.deps.startSandboxReadinessReconciliation
    ).not.toHaveBeenCalled();
    expect(scenario.events).toEqual([]);
  });

  it("should take a distinct replacement name when the old VM already holds the stable name", async () => {
    const scenario = buildScenario({ previousName: FRESH_NAME });

    const replaced = await fallbackFromBaselineToGit(
      scenario.input,
      scenario.helpers as never
    );

    expect(replaced).toBe(true);
    const replacementName = `${FRESH_NAME}-record1`;
    expect(scenario.deps.createSandboxForRepo).toHaveBeenCalledWith(
      expect.objectContaining({ name: replacementName })
    );
    // The record's compare-and-swap moves sandbox_id off the old name, so the
    // stale reconciler's guard is invalidated exactly as in the common case.
    expect(scenario.helpers.updateSandboxRecord).toHaveBeenCalledWith(
      "record-1",
      expect.objectContaining({ sandbox_id: replacementName }),
      expect.objectContaining({ expectedSandboxId: FRESH_NAME })
    );
    expect(
      scenario.deps.startSandboxReadinessReconciliation
    ).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSandboxId: replacementName })
    );
    expect(scenario.calls).toEqual([
      "create",
      "repoint",
      `stop:${FRESH_NAME}`,
      "billing",
    ]);
    expect(scenario.previous.stop).toHaveBeenCalledTimes(1);
  });
});
