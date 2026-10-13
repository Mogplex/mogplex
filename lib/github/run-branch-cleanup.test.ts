import { describe, expect, it } from "vitest";
import {
  deleteEmptyRunBranch,
  isDisposableRunBranch,
} from "./run-branch-cleanup";

type Route = (url: URL, init?: RequestInit) => Response;

function github(routes: { compare?: Route; pulls?: Route; remove?: Route }) {
  const calls: Array<{ method: string; path: string; search: string }> = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, search: url.search });
    if (url.pathname.includes("/compare/")) {
      return (routes.compare ?? (() => Response.json({ ahead_by: 0 })))(url);
    }
    if (url.pathname.endsWith("/pulls")) {
      return (routes.pulls ?? (() => Response.json([])))(url);
    }
    if (method === "DELETE") {
      return (routes.remove ?? (() => new Response(null, { status: 204 })))(
        url
      );
    }
    throw new Error(`unexpected ${method} ${url.pathname}`);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const input = {
  owner: "acme",
  repo: "widgets",
  baseBranch: "main",
  branch: "mogplex/external/f0974413-881d44ff",
  githubToken: "token",
};

describe("isDisposableRunBranch", () => {
  it.each([
    "mogplex/external/f0974413-881d44ff",
    "mogplex/task-3cc31654-1111-2222-3333-444444444444",
    "mogplex/agent-0123456789ab",
  ])("should accept the per-run branch %s", (branch) => {
    expect(isDisposableRunBranch(branch, "main")).toBe(true);
  });

  it.each([
    "main",
    "feat/agent-context-precision",
    "mogplex/automation-0123456789abcdef",
    "mogplex/vmotif-20260924t222446",
    "mogplex/dependabot-12-abc",
  ])("should refuse %s", (branch) => {
    expect(isDisposableRunBranch(branch, "main")).toBe(false);
  });

  it("should refuse a run branch that is the base branch", () => {
    expect(
      isDisposableRunBranch(
        "mogplex/agent-0123456789ab",
        "mogplex/agent-0123456789ab"
      )
    ).toBe(false);
  });
});

describe("deleteEmptyRunBranch", () => {
  it("should delete an empty run branch that never had a pull request", async () => {
    const { calls, fetchImpl } = github({});
    await expect(deleteEmptyRunBranch({ ...input, fetchImpl })).resolves.toBe(
      "deleted"
    );
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/repos/acme/widgets/compare/main...mogplex/external/f0974413-881d44ff",
        search: "?per_page=1",
      },
      {
        method: "GET",
        path: "/repos/acme/widgets/pulls",
        search:
          "?state=all&head=acme%3Amogplex%2Fexternal%2Ff0974413-881d44ff&per_page=1",
      },
      {
        method: "DELETE",
        path: "/repos/acme/widgets/git/refs/heads/mogplex/external/f0974413-881d44ff",
        search: "",
      },
    ]);
  });

  it("should keep a branch with commits beyond the base", async () => {
    const { calls, fetchImpl } = github({
      compare: () => Response.json({ ahead_by: 1 }),
    });
    await expect(deleteEmptyRunBranch({ ...input, fetchImpl })).resolves.toBe(
      "kept"
    );
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("should keep an empty branch that had a pull request", async () => {
    const { calls, fetchImpl } = github({
      pulls: () => Response.json([{ number: 3 }]),
    });
    await expect(deleteEmptyRunBranch({ ...input, fetchImpl })).resolves.toBe(
      "kept"
    );
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("should report a branch that is already gone", async () => {
    const { fetchImpl } = github({
      compare: () => new Response(null, { status: 404 }),
    });
    await expect(deleteEmptyRunBranch({ ...input, fetchImpl })).resolves.toBe(
      "absent"
    );
  });

  it.each([
    [
      "the comparison fails",
      { compare: () => new Response(null, { status: 500 }) },
    ],
    ["the comparison has no count", { compare: () => Response.json({}) }],
    [
      "the pull request lookup fails",
      { pulls: () => new Response(null, { status: 502 }) },
    ],
  ])("should keep the branch when %s", async (_label, routes) => {
    const { calls, fetchImpl } = github(routes);
    await expect(deleteEmptyRunBranch({ ...input, fetchImpl })).resolves.toBe(
      "skipped"
    );
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("should never call GitHub for a branch the user owns", async () => {
    const { calls, fetchImpl } = github({});
    await expect(
      deleteEmptyRunBranch({
        ...input,
        branch: "mogplex/automation-0123456789abcdef",
        fetchImpl,
      })
    ).resolves.toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("should not throw when the network fails", async () => {
    const fetchImpl = (async () => {
      throw new Error("socket hang up");
    }) as typeof fetch;
    await expect(deleteEmptyRunBranch({ ...input, fetchImpl })).resolves.toBe(
      "skipped"
    );
  });
});
