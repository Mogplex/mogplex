import { describe, expect, it } from "vitest";
import {
  buildBaselineCheckoutCommand,
  buildBaselineFetchCommand,
  resolveBaselineFetchRefs,
} from "./baseline-git-commands";

describe("baseline snapshot git commands", () => {
  it("should fetch with an explicit tracking refspec so origin/<branch> exists", () => {
    const command = buildBaselineFetchCommand({
      baseBranch: "main",
      workingBranch: "main",
      createBranch: false,
    });

    expect(command).toBe(
      "git fetch --depth=1 origin '+refs/heads/main:refs/remotes/origin/main'"
    );
  });

  it("should fetch both branches when checking out an existing working branch", () => {
    const opts = {
      baseBranch: "main",
      workingBranch: "feature/chip",
      createBranch: false,
    };

    expect(resolveBaselineFetchRefs(opts)).toEqual(["main", "feature/chip"]);
    expect(buildBaselineFetchCommand(opts)).toBe(
      "git fetch --depth=1 origin '+refs/heads/main:refs/remotes/origin/main' '+refs/heads/feature/chip:refs/remotes/origin/feature/chip'"
    );
  });

  it("should fetch only the base branch when the working branch is new", () => {
    const opts = {
      baseBranch: "main",
      workingBranch: "mogplex/agent-1",
      createBranch: true,
    };

    expect(resolveBaselineFetchRefs(opts)).toEqual(["main"]);
    expect(buildBaselineCheckoutCommand(opts)).toBe(
      "git checkout -b 'mogplex/agent-1' origin/'main' && git push -u origin 'mogplex/agent-1'"
    );
  });

  it("should reset an existing working branch onto its fetched tracking ref", () => {
    expect(
      buildBaselineCheckoutCommand({
        baseBranch: "main",
        workingBranch: "main",
        createBranch: false,
      })
    ).toBe("git checkout -B 'main' origin/'main'");
  });

  it("should shell-quote branch names in the refspec", () => {
    expect(
      buildBaselineFetchCommand({
        baseBranch: "release/it's",
        workingBranch: "release/it's",
        createBranch: false,
      })
    ).toBe(
      "git fetch --depth=1 origin '+refs/heads/release/it'\\''s:refs/remotes/origin/release/it'\\''s'"
    );
  });
});
