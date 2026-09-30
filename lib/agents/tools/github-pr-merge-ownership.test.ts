import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPullRequestOwnership,
  mergeAuthorBasis,
  type PullRequestOwnership,
} from "./github-pr-merge-ownership";

const originalAppName = process.env.GITHUB_APP_NAME;

beforeEach(() => {
  process.env.GITHUB_APP_NAME = "mogplex";
});

afterEach(() => {
  process.env.GITHUB_APP_NAME = originalAppName;
});

function ownership(
  overrides: Partial<PullRequestOwnership> = {}
): PullRequestOwnership {
  return {
    authorLogin: "mallory",
    authorIsBot: false,
    reviewDecision: null,
    url: "https://github.com/acme/widgets/pull/84",
    ...overrides,
  };
}

const userLogin = (login: string | null) => async () => login;

describe("mergeAuthorBasis", () => {
  it("should allow a PR the Mogplex app opened", async () => {
    await expect(
      mergeAuthorBasis(
        ownership({ authorLogin: "mogplex[bot]", authorIsBot: true }),
        userLogin(null)
      )
    ).resolves.toBe("mogplex_author");
  });

  it("should allow a PR the user authored, ignoring login case", async () => {
    await expect(
      mergeAuthorBasis(
        ownership({ authorLogin: "Charles" }),
        userLogin("charles")
      )
    ).resolves.toBe("user_author");
  });

  it("should refuse someone else's PR when no review is required", async () => {
    await expect(
      mergeAuthorBasis(ownership(), userLogin("charles"))
    ).resolves.toBeNull();
  });

  it("should refuse a PR when the user has no linked GitHub login", async () => {
    await expect(
      mergeAuthorBasis(ownership(), userLogin(null))
    ).resolves.toBeNull();
  });

  it("should not treat a user named like the app as the app", async () => {
    await expect(
      mergeAuthorBasis(ownership({ authorLogin: "mogplex" }), userLogin(null))
    ).resolves.toBeNull();
  });

  it("should defer someone else's PR to a required human review", async () => {
    await expect(
      mergeAuthorBasis(
        ownership({ reviewDecision: "REVIEW_REQUIRED" }),
        userLogin("charles")
      )
    ).resolves.toBe("human_review");
  });
});

describe("loadPullRequestOwnership", () => {
  const input = {
    githubToken: "t",
    owner: "acme",
    repo: "widgets",
    number: 84,
  };

  it("should read the author and review decision from GitHub", async () => {
    const fetchImpl = (async () =>
      Response.json({
        data: {
          repository: {
            pullRequest: {
              url: "https://github.com/acme/widgets/pull/84",
              reviewDecision: "APPROVED",
              author: { __typename: "Bot", login: "mogplex" },
            },
          },
        },
      })) as unknown as typeof fetch;

    await expect(
      loadPullRequestOwnership({ ...input, fetchImpl })
    ).resolves.toEqual({
      authorLogin: "mogplex",
      authorIsBot: true,
      reviewDecision: "APPROVED",
      url: "https://github.com/acme/widgets/pull/84",
    });
  });

  it("should throw when GitHub does not return the pull request", async () => {
    const fetchImpl = (async () =>
      Response.json({
        data: { repository: { pullRequest: null } },
        errors: [{ message: "Could not resolve to a PullRequest" }],
      })) as unknown as typeof fetch;

    await expect(
      loadPullRequestOwnership({ ...input, fetchImpl })
    ).rejects.toThrow("Could not resolve to a PullRequest");
  });
});
