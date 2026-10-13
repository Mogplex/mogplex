import { describe, expect, it } from "vitest";
import {
  classifyBranch,
  loadBranchInventoryPage,
  type BranchSnapshot,
} from "./github-branch-status";

function snapshot(patch: Partial<BranchSnapshot>): BranchSnapshot {
  return {
    name: "feature/x",
    sha: "tip",
    committedAt: null,
    isProtected: false,
    commitsNotOnDefault: 2,
    pullRequests: [],
    ...patch,
  };
}

describe("classifyBranch", () => {
  it("should mark the default branch as never deletable", () => {
    const result = classifyBranch(
      snapshot({ name: "main", commitsNotOnDefault: 0 }),
      "main"
    );
    expect(result).toMatchObject({ status: "default", safeToDelete: false });
  });

  it("should mark a branch fully contained in the default branch as merged", () => {
    expect(
      classifyBranch(snapshot({ commitsNotOnDefault: 0 }), "main")
    ).toMatchObject({ status: "merged", safeToDelete: true });
  });

  it("should treat a squash-merged pull request at the branch tip as landed", () => {
    const result = classifyBranch(
      snapshot({
        pullRequests: [
          { number: 4, state: "MERGED", headRefOid: "tip", url: "u" },
        ],
      }),
      "main"
    );
    expect(result).toMatchObject({
      status: "squash_merged",
      safeToDelete: true,
      pullRequest: { number: 4, state: "MERGED", url: "u" },
    });
  });

  it("should keep a branch that moved after its pull request merged", () => {
    const result = classifyBranch(
      snapshot({
        pullRequests: [
          { number: 4, state: "MERGED", headRefOid: "older", url: null },
        ],
      }),
      "main"
    );
    expect(result).toMatchObject({ status: "unmerged", safeToDelete: false });
  });

  it("should keep a branch with an open pull request even when it is merged", () => {
    const result = classifyBranch(
      snapshot({
        commitsNotOnDefault: 0,
        pullRequests: [
          { number: 9, state: "OPEN", headRefOid: "tip", url: null },
        ],
      }),
      "main"
    );
    expect(result).toMatchObject({
      status: "open_pull_request",
      safeToDelete: false,
    });
  });

  it("should report a closed, unmerged pull request as unmerged work", () => {
    const result = classifyBranch(
      snapshot({
        pullRequests: [
          { number: 2, state: "CLOSED", headRefOid: "tip", url: null },
        ],
      }),
      "main"
    );
    expect(result).toMatchObject({
      status: "closed_unmerged",
      safeToDelete: false,
    });
  });

  it("should never mark a protected branch safe to delete", () => {
    expect(
      classifyBranch(
        snapshot({ commitsNotOnDefault: 0, isProtected: true }),
        "main"
      )
    ).toMatchObject({ status: "merged", safeToDelete: false });
  });

  it("should treat an unknown comparison as unmerged", () => {
    expect(
      classifyBranch(snapshot({ commitsNotOnDefault: null }), "main")
    ).toMatchObject({ status: "unmerged", safeToDelete: false });
  });
});

describe("loadBranchInventoryPage", () => {
  const input = {
    owner: "acme",
    repo: "widgets",
    defaultBranch: "main",
    githubToken: "token",
  };

  it("should compare every branch against the default branch and page with a cursor", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const page = await loadBranchInventoryPage({
      ...input,
      cursor: "c1",
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)).variables);
        return Response.json({
          data: {
            repository: {
              defaultBranchRef: { name: "main" },
              refs: {
                totalCount: 120,
                pageInfo: { hasNextPage: true, endCursor: "c2" },
                nodes: [
                  {
                    name: "old",
                    target: { oid: "x", committedDate: "2026-01-01" },
                    compare: { behindBy: 0 },
                    associatedPullRequests: { nodes: [] },
                  },
                ],
              },
            },
          },
        });
      }) as typeof fetch,
    });
    expect(requests[0]).toMatchObject({
      after: "c1",
      defaultRef: "refs/heads/main",
    });
    expect(page).toMatchObject({
      totalBranches: 120,
      nextCursor: "c2",
      branches: [{ name: "old", status: "merged", safeToDelete: true }],
    });
  });

  it("should surface GitHub's error instead of an empty inventory", async () => {
    const page = await loadBranchInventoryPage({
      ...input,
      fetchImpl: (async () =>
        Response.json({
          errors: [{ message: "Could not resolve to a Repository" }],
        })) as unknown as typeof fetch,
    });
    expect(page).toEqual({
      error:
        "GitHub could not list branches for acme/widgets: Could not resolve to a Repository.",
    });
  });
});
