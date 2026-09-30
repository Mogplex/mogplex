import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPullRequestOwnership,
  mergeAuthorBasis,
  rulesetRequiresReview,
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
    baseRefName: "main",
    url: "https://github.com/acme/widgets/pull/84",
    ...overrides,
  };
}

const userLogin = (login: string | null, rulesetReview = false) => ({
  userGithubLogin: async () => login,
  rulesetRequiresReview: async () => rulesetReview,
});

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

  it("should match the app when GITHUB_APP_NAME carries the [bot] suffix", async () => {
    process.env.GITHUB_APP_NAME = "mogplex[bot]";
    await expect(
      mergeAuthorBasis(
        ownership({ authorLogin: "mogplex", authorIsBot: true }),
        userLogin(null)
      )
    ).resolves.toBe("mogplex_author");
  });

  it("should defer someone else's PR to a review a ruleset requires", async () => {
    await expect(
      mergeAuthorBasis(ownership(), userLogin("charles", true))
    ).resolves.toBe("human_review");
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
              baseRefName: "main",
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
      baseRefName: "main",
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

describe("rulesetRequiresReview", () => {
  const input = {
    githubToken: "t",
    owner: "acme",
    repo: "widgets",
    branch: "main",
  };
  const respond = (body: unknown, status = 200) =>
    (async () => Response.json(body, { status })) as unknown as typeof fetch;

  it("should see an approving-review requirement in the branch rules", async () => {
    await expect(
      rulesetRequiresReview({
        ...input,
        fetchImpl: respond([
          {
            type: "pull_request",
            parameters: { required_approving_review_count: 1 },
          },
        ]),
      })
    ).resolves.toBe(true);
  });

  it("should not count a pull request rule that needs no approvals", async () => {
    await expect(
      rulesetRequiresReview({
        ...input,
        fetchImpl: respond([
          {
            type: "pull_request",
            parameters: { required_approving_review_count: 0 },
          },
        ]),
      })
    ).resolves.toBe(false);
  });

  it("should honor code-owner and named-reviewer requirements", async () => {
    for (const parameters of [
      { require_code_owner_review: true },
      { required_reviewers: [{ minimum_approvals: 1 }] },
    ]) {
      await expect(
        rulesetRequiresReview({
          ...input,
          fetchImpl: respond([{ type: "pull_request", parameters }]),
        })
      ).resolves.toBe(true);
    }
  });

  it("should find a review requirement past the first page of rules", async () => {
    const filler = Array.from({ length: 100 }, () => ({ type: "deletion" }));
    const pages: string[] = [];
    const fetchImpl = (async (url: string) => {
      pages.push(new URL(url).searchParams.get("page") ?? "");
      return Response.json(
        pages.length === 1
          ? filler
          : [
              {
                type: "pull_request",
                parameters: { required_approving_review_count: 2 },
              },
            ]
      );
    }) as unknown as typeof fetch;

    await expect(rulesetRequiresReview({ ...input, fetchImpl })).resolves.toBe(
      true
    );
    expect(pages).toEqual(["1", "2"]);
  });

  it("should treat a network failure as no confirmed requirement", async () => {
    const fetchImpl = (async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;

    await expect(rulesetRequiresReview({ ...input, fetchImpl })).resolves.toBe(
      false
    );
  });

  it("should treat unreadable rules as no confirmed requirement", async () => {
    await expect(
      rulesetRequiresReview({ ...input, fetchImpl: respond({}, 404) })
    ).resolves.toBe(false);
  });
});
