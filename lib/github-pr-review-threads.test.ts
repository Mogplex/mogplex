import { afterEach, describe, expect, it, vi } from "vitest";
import {
  comparePrCommits,
  listPrConversationComments,
  listPrReviewThreads,
  replyAndResolvePrReviewThread,
} from "./github-pr-review-threads";

afterEach(() => {
  vi.unstubAllGlobals();
});

const target = {
  githubToken: "token",
  repoFullName: "acme/widgets",
  prNumber: 7,
};

const rootComment = (id: string) => ({
  id: `${id}-c0`,
  body: "**Warning:** x",
  url: `https://github.com/acme/widgets/pull/7#${id}`,
  createdAt: "2026-11-09T10:00:00Z",
  author: { login: "mogplex" },
});
const reply = (id: string, index: number) => ({
  id: `${id}-c${index}`,
  body: `Reply ${index}`,
  url: "u",
  createdAt: "2026-11-09T11:00:00Z",
  author: null,
});

/** A short thread: the latest comments include the root too. */
const threadNode = (id: string) => ({
  id,
  isResolved: false,
  path: "lib/a.ts",
  line: 4,
  root: { nodes: [rootComment(id)] },
  recent: { nodes: [rootComment(id), reply(id, 1)] },
});

const threadsPage = (
  ids: string[],
  next: string | null
): Record<string, unknown> => ({
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: next != null, endCursor: next },
          nodes: ids.map(threadNode),
        },
      },
    },
  },
});

describe("listPrReviewThreads", () => {
  it("should page through every thread with its comments", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(threadsPage(["t1"], "cursor-1")))
      .mockResolvedValueOnce(Response.json(threadsPage(["t2"], null)));
    vi.stubGlobal("fetch", fetchMock);

    const threads = await listPrReviewThreads(target);

    expect(threads.map((thread) => thread.id)).toEqual(["t1", "t2"]);
    expect(threads[0]).toMatchObject({
      url: "https://github.com/acme/widgets/pull/7#t1",
      comments: [
        { author: "mogplex", body: "**Warning:** x" },
        { author: null, body: "Reply 1" },
      ],
    });
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondBody.variables).toMatchObject({
      owner: "acme",
      repo: "widgets",
      number: 7,
      after: "cursor-1",
    });
  });

  it("should stop when GitHub hands back the cursor it was given", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(threadsPage(["t1"], "cursor-1")))
      .mockResolvedValue(Response.json(threadsPage(["t2"], "cursor-1")));
    vi.stubGlobal("fetch", fetchMock);

    const threads = await listPrReviewThreads(target);

    expect(threads.map((thread) => thread.id)).toEqual(["t1", "t2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("should keep the root comment and the latest replies of a long thread", async () => {
    const long = {
      ...threadNode("t1"),
      recent: {
        nodes: Array.from({ length: 100 }, (_, index) =>
          reply("t1", index + 50)
        ),
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [long],
                },
              },
            },
          },
        })
      )
    );

    const [thread] = await listPrReviewThreads(target);

    expect(thread.comments).toHaveLength(101);
    expect(thread.comments[0].body).toBe("**Warning:** x");
    expect(thread.comments[100].body).toBe("Reply 149");
  });

  it("should throw when GraphQL reports an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ errors: [{ message: "Bad credentials" }] })
        )
    );

    await expect(listPrReviewThreads(target)).rejects.toThrow(
      "Bad credentials"
    );
  });
});

describe("replyAndResolvePrReviewThread", () => {
  it("should reply first and then resolve the thread", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: { addPullRequestReviewThreadReply: { comment: { id: "c" } } },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          data: { resolveReviewThread: { thread: { isResolved: true } } },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await replyAndResolvePrReviewThread({
      githubToken: "token",
      threadId: "t1",
      body: "No longer reported.",
    });

    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body))
    );
    expect(bodies[0].query).toContain("addPullRequestReviewThreadReply");
    expect(bodies[0].variables).toEqual({
      thread: "t1",
      body: "No longer reported.",
    });
    expect(bodies[1].query).toContain("resolveReviewThread");
  });

  it("should not resolve a thread it could not reply to", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      replyAndResolvePrReviewThread({
        githubToken: "token",
        threadId: "t1",
        body: "x",
      })
    ).rejects.toThrow("(403)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("comparePrCommits", () => {
  it("should return the status and the changed files", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status: "ahead",
        files: [{ filename: "lib/a.ts" }, { filename: 3 }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await comparePrCommits({
      githubToken: "token",
      repoFullName: "acme/widgets",
      base: "old",
      head: "new",
    });

    expect(result).toEqual({
      status: "ahead",
      files: ["lib/a.ts"],
      complete: true,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/acme/widgets/compare/old...new"
    );
  });

  it("should mark a 300-file comparison as possibly cut", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          status: "ahead",
          files: Array.from({ length: 300 }, (_, index) => ({
            filename: `f${index}`,
          })),
        })
      )
    );

    const result = await comparePrCommits({
      githubToken: "token",
      repoFullName: "acme/widgets",
      base: "old",
      head: "new",
    });

    expect(result.complete).toBe(false);
  });

  it("should throw when the commits cannot be compared", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ message: "No common ancestor" }, { status: 404 })
        )
    );

    await expect(
      comparePrCommits({
        githubToken: "token",
        repoFullName: "acme/widgets",
        base: "old",
        head: "new",
      })
    ).rejects.toThrow("(404)");
  });
});

describe("listPrConversationComments", () => {
  const comment = (createdAt: string, type = "User") => ({
    body: `at ${createdAt}`,
    created_at: createdAt,
    user: { login: type === "Bot" ? "ci[bot]" : "dev", type },
  });

  it("should keep only comments created after the last review and flag bots", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json([
          comment("2026-11-09T09:00:00Z"),
          comment("2026-11-09T10:00:00Z"),
          comment("2026-11-09T11:00:00Z"),
          comment("2026-11-09T12:00:00Z", "Bot"),
          { body: null, created_at: "2026-11-09T12:00:00Z" },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const comments = await listPrConversationComments({
      ...target,
      since: "2026-11-09T10:00:00.000Z",
    });

    expect(comments).toEqual([
      {
        author: "dev",
        isBot: false,
        body: "at 2026-11-09T11:00:00Z",
        createdAt: "2026-11-09T11:00:00Z",
      },
      {
        author: "ci[bot]",
        isBot: true,
        body: "at 2026-11-09T12:00:00Z",
        createdAt: "2026-11-09T12:00:00Z",
      },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/issues/7/comments?since=2026-11-09T10%3A00%3A00.000Z&per_page=100&page=1"
    );
  });

  it("should read the next page while pages are full", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          Array.from({ length: 100 }, () => comment("2026-11-09T11:00:00Z"))
        )
      )
      .mockResolvedValueOnce(Response.json([comment("2026-11-09T12:00:00Z")]));
    vi.stubGlobal("fetch", fetchMock);

    const comments = await listPrConversationComments({
      ...target,
      since: "2026-11-09T10:00:00Z",
    });

    expect(comments).toHaveLength(101);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("&page=2");
  });

  it("should throw when GitHub refuses the lookup", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ message: "x" }, { status: 500 }))
    );

    await expect(
      listPrConversationComments({ ...target, since: "2026-11-09T10:00:00Z" })
    ).rejects.toThrow("(500)");
  });
});
