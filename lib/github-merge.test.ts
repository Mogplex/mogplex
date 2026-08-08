import { describe, expect, it } from "vitest";
import { queuePullRequestForMerge } from "./github-merge";

type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

function jsonResponse(body: unknown, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeFetch(responses: FakeResponse[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit
  ) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("fetch called more times than expected");
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const baseInput = {
  githubToken: "token",
  owner: "webrenew",
  repo: "vmotif",
  prNumber: 42,
};

const cleanPr = {
  state: "open",
  draft: false,
  mergeable: true,
  mergeable_state: "clean",
  node_id: "PR_kwDOAutoMerge42",
  head: { sha: "abc123" },
};

describe("queuePullRequestForMerge", () => {
  it("refuses to queue a draft PR", async () => {
    const { fetchImpl, calls } = makeFetch([
      jsonResponse({ ...cleanPr, draft: true }),
    ]);

    const outcome = await queuePullRequestForMerge({ ...baseInput, fetchImpl });

    expect(outcome.merged).toBe(false);
    expect(outcome.reason).toMatch(/draft/i);
    expect(calls).toHaveLength(1);
  });

  it("arms GitHub auto-merge on a clean open PR", async () => {
    const { fetchImpl, calls } = makeFetch([
      jsonResponse(cleanPr),
      jsonResponse({
        data: {
          enablePullRequestAutoMerge: {
            pullRequest: {
              autoMergeRequest: { enabledAt: "2026-08-08T02:00:00Z" },
            },
          },
        },
      }),
    ]);

    const outcome = await queuePullRequestForMerge({ ...baseInput, fetchImpl });

    expect(outcome.merged).toBe(false);
    expect(outcome.queued).toBe(true);
    expect(outcome.reason).toMatch(/auto-merge enabled/i);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe("https://api.github.com/graphql");
    const body = JSON.parse(String(calls[1]?.init?.body));
    expect(body.variables.input).toEqual({
      pullRequestId: "PR_kwDOAutoMerge42",
      mergeMethod: "SQUASH",
      expectedHeadOid: "abc123",
    });
  });
});
