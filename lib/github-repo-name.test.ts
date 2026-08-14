import { describe, expect, it } from "vitest";

import {
  normalizeGithubRepoName,
  validateGithubRepoName,
} from "./github-repo-name";

describe("GitHub repository names", () => {
  it("preserves GitHub's supported characters", () => {
    expect(normalizeGithubRepoName("Mogplex.api_v2")).toBe("Mogplex.api_v2");
    expect(validateGithubRepoName("Mogplex.api_v2")).toEqual({
      ok: true,
      name: "Mogplex.api_v2",
      normalized: false,
    });
  });

  it("surfaces the safe name GitHub will receive", () => {
    expect(normalizeGithubRepoName("  Analytics / redesign 🚀  ")).toBe(
      "Analytics-redesign"
    );
    expect(validateGithubRepoName("  Analytics / redesign 🚀  ")).toEqual({
      ok: true,
      name: "Analytics-redesign",
      normalized: true,
    });
  });

  it("rejects empty, reserved, and overlong names", () => {
    expect(validateGithubRepoName(null)).toEqual({
      ok: false,
      message: "Use letters, numbers, periods, hyphens, or underscores.",
    });
    expect(validateGithubRepoName("🚀")).toEqual({
      ok: false,
      message: "Use letters, numbers, periods, hyphens, or underscores.",
    });
    expect(validateGithubRepoName("..")).toEqual({
      ok: false,
      message: "Choose a repository name other than . or ...",
    });
    expect(validateGithubRepoName("a".repeat(101))).toEqual({
      ok: false,
      message: "Repository names must be 100 characters or fewer.",
    });
  });
});
