import { describe, expect, it } from "vitest";
import { buildRunRow } from "../../tests/unit/helpers/mogplex-api-runs-fixtures";
import {
  branchesCreatedByRun,
  cleanupTerminalRunBranches,
} from "./run-branch-cleanup";

const AI_CALL_ID = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";
const HARNESS_BRANCH = "mogplex/agent-0a1b2c3d4e5f";

describe("branchesCreatedByRun", () => {
  it("should include the fresh working branch the run asked for", () => {
    expect(
      branchesCreatedByRun(
        buildRunRow({
          create_branch: true,
          working_branch: "mogplex/external/f0974413-881d44ff",
        }),
        null
      )
    ).toEqual(["mogplex/external/f0974413-881d44ff"]);
  });

  it("should exclude a branch the caller supplied", () => {
    expect(
      branchesCreatedByRun(
        buildRunRow({ create_branch: false, working_branch: "feature/mine" }),
        { metadata: { working_branch: "feature/mine" } }
      )
    ).toEqual([]);
  });

  it("should include the CLI harness fallback branch built from this run's call", () => {
    expect(
      branchesCreatedByRun(
        buildRunRow({
          ai_call_id: AI_CALL_ID,
          create_branch: false,
          working_branch: "main",
        }),
        { metadata: { working_branch: HARNESS_BRANCH } }
      )
    ).toEqual([HARNESS_BRANCH]);
  });

  it("should ignore another run's agent branch recorded on the call", () => {
    expect(
      branchesCreatedByRun(
        buildRunRow({ ai_call_id: AI_CALL_ID, create_branch: false }),
        { metadata: { working_branch: "mogplex/agent-ffffffffffff" } }
      )
    ).toEqual([]);
  });
});

describe("cleanupTerminalRunBranches", () => {
  const run = buildRunRow({
    status: "success",
    create_branch: true,
    base_branch: "main",
    working_branch: "mogplex/external/f0974413-881d44ff",
  });
  const repo = {
    user_id: run.user_id,
    full_name: "webrenew/vmotif",
    github_installation_id: 7,
  };

  it("should ask GitHub to delete the run's branch when it is empty", async () => {
    const deletions: unknown[] = [];
    await cleanupTerminalRunBranches(run, null, {
      loadRepo: async () => repo,
      loadToken: async () => "token",
      deleteBranch: async (input) => {
        deletions.push(input);
        return "deleted";
      },
    });
    expect(deletions).toEqual([
      {
        owner: "webrenew",
        repo: "vmotif",
        baseBranch: "main",
        branch: "mogplex/external/f0974413-881d44ff",
        githubToken: "token",
      },
    ]);
  });

  it("should leave worktree runs alone", async () => {
    let loaded = false;
    await cleanupTerminalRunBranches({ ...run, worktree_id: "wt-1" }, null, {
      loadRepo: async () => {
        loaded = true;
        return repo;
      },
    });
    expect(loaded).toBe(false);
  });

  it("should swallow lookup failures so finalization never fails on cleanup", async () => {
    await expect(
      cleanupTerminalRunBranches(run, null, {
        loadRepo: async () => {
          throw new Error("db down");
        },
      })
    ).resolves.toBeUndefined();
  });

  it("should skip cleanup without a GitHub token", async () => {
    let attempted = false;
    await cleanupTerminalRunBranches(run, null, {
      loadRepo: async () => repo,
      loadToken: async () => null,
      deleteBranch: async () => {
        attempted = true;
        return "deleted";
      },
    });
    expect(attempted).toBe(false);
  });
});
