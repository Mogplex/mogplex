import { describe, expect, it, vi } from "vitest";
import { dispatchSandboxLaunchIntent } from "@/lib/sandbox/launch-intent";
import { sandboxRecord } from "@/lib/sandbox/test-fixtures";

const repo = {
  id: "repo-1",
  full_name: "acme/repo",
  default_branch: "main",
  root_directory: null,
  is_monorepo: false,
  sandbox_env_vars: null,
  env_sync_mode: "sandbox-only" as const,
  vercel_project_id: null,
};

describe("dispatchSandboxLaunchIntent", () => {
  it("resumes by record id without requesting launch choice", async () => {
    const record = sandboxRecord({
      status: "paused",
      healthStatus: "paused",
      snapshotId: "snapshot-1",
    });
    const requestLaunchChoice = vi.fn();
    const resumeSandbox = vi.fn(async () => record);
    const track = vi.fn();

    const result = await dispatchSandboxLaunchIntent(
      repo,
      {
        source: "preview_pane",
        trigger: "status_overlay",
        intent: { kind: "resume", sandboxRecordId: record.id },
      },
      {
        launch: async () => {
          throw new Error("launch should not be called");
        },
        resumeSandbox,
        getSandboxById: () => record,
        requestLaunchChoice,
        track,
      }
    );

    expect(result).toEqual({ status: "launched", sandbox: record });
    expect(resumeSandbox).toHaveBeenCalledWith(record.id);
    expect(requestLaunchChoice).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(
      "sandbox_resumed",
      expect.objectContaining({ branch_name: "feature/chip" })
    );
  });

  it("restarts on the existing branch without requesting launch choice", async () => {
    const record = sandboxRecord({
      status: "stopped",
      workingBranch: "feature/x",
      rootDirectory: "apps/web",
    });
    const onConfirmed = vi.fn();
    const launch = vi.fn(async () => record);
    const requestLaunchChoice = vi.fn();
    const track = vi.fn();

    const result = await dispatchSandboxLaunchIntent(
      repo,
      {
        source: "preview_pane",
        trigger: "status_overlay",
        intent: { kind: "restart_on_branch", sandboxRecordId: record.id },
        onConfirmed,
      },
      {
        launch,
        resumeSandbox: async () => {
          throw new Error("resumeSandbox should not be called");
        },
        getSandboxById: () => record,
        requestLaunchChoice,
        track,
      }
    );

    expect(result).toEqual({ status: "launched", sandbox: record });
    expect(requestLaunchChoice).not.toHaveBeenCalled();
    expect(onConfirmed).toHaveBeenCalledWith({
      repoId: repo.id,
      baseBranch: "main",
      workingBranch: "feature/x",
      rootDirectory: "apps/web",
      createBranch: false,
    });
    expect(launch).toHaveBeenCalledWith(
      repo.id,
      {
        repoId: repo.id,
        baseBranch: "main",
        workingBranch: "feature/x",
        rootDirectory: "apps/web",
        createBranch: false,
      },
      { launchAttemptId: undefined }
    );
    expect(track).toHaveBeenCalledWith(
      "sandbox_restarted_on_branch",
      expect.objectContaining({ branch_name: "feature/x" })
    );
  });

  it("keeps the existing modal/default launch behavior for start_fresh", async () => {
    const record = sandboxRecord();
    const requestLaunchChoice = vi.fn(async () => ({
      baseBranch: "main",
      workingBranch: "mogplex/repo-20260513",
      createBranch: true,
    }));
    const onConfirmed = vi.fn();
    const launch = vi.fn(async () => record);
    const track = vi.fn();

    const result = await dispatchSandboxLaunchIntent(
      repo,
      {
        source: "home_pane",
        trigger: "open_workspace",
        intent: { kind: "start_fresh" },
        launchAttemptId: "launch-123",
        onConfirmed,
      },
      {
        launch,
        resumeSandbox: async () => null,
        getSandboxById: () => null,
        requestLaunchChoice,
        track,
      }
    );

    expect(result).toEqual({ status: "launched", sandbox: record });
    expect(requestLaunchChoice).toHaveBeenCalledWith(repo);
    expect(onConfirmed).toHaveBeenCalledWith({
      repoId: repo.id,
      baseBranch: "main",
      workingBranch: "mogplex/repo-20260513",
      createBranch: true,
    });
    expect(launch).toHaveBeenCalledWith(
      repo.id,
      {
        repoId: repo.id,
        baseBranch: "main",
        workingBranch: "mogplex/repo-20260513",
        createBranch: true,
      },
      { launchAttemptId: "launch-123" }
    );
    expect(track).toHaveBeenCalledWith(
      "preview_started",
      expect.objectContaining({ branch_mode: "new_branch" })
    );
  });

  it("returns cancelled when the launch modal is dismissed", async () => {
    const requestLaunchChoice = vi.fn(async () => null);
    const launch = vi.fn();
    const onConfirmed = vi.fn();
    const track = vi.fn();

    const result = await dispatchSandboxLaunchIntent(
      repo,
      {
        source: "home_pane",
        trigger: "open_workspace",
        intent: { kind: "start_fresh" },
        onConfirmed,
      },
      {
        launch,
        resumeSandbox: async () => null,
        getSandboxById: () => null,
        requestLaunchChoice,
        track,
      }
    );

    expect(result).toEqual({ status: "cancelled", sandbox: null });
    expect(requestLaunchChoice).toHaveBeenCalledWith(repo);
    expect(launch).not.toHaveBeenCalled();
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});
