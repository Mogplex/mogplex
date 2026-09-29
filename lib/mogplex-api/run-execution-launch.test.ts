import { describe, expect, it } from "vitest";
import { buildRunRow } from "../../tests/unit/helpers/mogplex-api-runs-fixtures";
import {
  launchSandboxViaRoute,
  runSandboxLaunchBody,
} from "./run-execution-launch";

describe("runSandboxLaunchBody", () => {
  it("should launch the run's repo, branches, and root directory", () => {
    expect(
      runSandboxLaunchBody({
        repo_id: "repo-1",
        base_branch: "main",
        working_branch: "mogplex/run-1",
        create_branch: true,
        root_directory: "apps/web",
      })
    ).toEqual({
      repoId: "repo-1",
      baseBranch: "main",
      workingBranch: "mogplex/run-1",
      createBranch: true,
      rootDirectory: "apps/web",
    });
  });
});

describe("launchSandboxViaRoute", () => {
  it("should reuse the sandbox already on the run without launching", async () => {
    await expect(
      launchSandboxViaRoute(
        buildRunRow({ sandbox_record_id: "record-9", sandbox_id: "vm-9" })
      )
    ).resolves.toEqual({ recordId: "record-9", sandboxId: "vm-9" });
  });
});
