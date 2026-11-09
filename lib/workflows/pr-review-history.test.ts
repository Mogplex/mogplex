import { describe, expect, it } from "vitest";
import type { PrReviewThread } from "@/lib/github-pr-review-threads";
import {
  collectPriorFindings,
  findingKeyOf,
  findingMarker,
  loadPrReviewHistory,
  newestPrReviewState,
  parsePrReviewState,
  serializePrReviewState,
  type LoadPrReviewHistoryDeps,
  type PrReviewState,
} from "./pr-review-history";
import { createPrReviewSigner } from "./pr-review-signing";

const signer = createPrReviewSigner("test-secret", {
  repoFullName: "acme/widgets",
  prNumber: 7,
});

const state: PrReviewState = {
  sha: "aaaaaaa1111",
  reviewedAt: "2026-11-09T10:00:00.000Z",
  findings: [
    {
      key: "aaaaaaaaaaaa",
      severity: "warning",
      title: "Unchecked null",
      path: "lib/a.ts",
      line: 4,
      inline: true,
    },
    {
      key: "bbbbbbbbbbbb",
      severity: "suggestion",
      title: "Rename helper",
      path: null,
      line: null,
      inline: false,
    },
  ],
};

const thread = (
  key: string,
  overrides: Partial<PrReviewThread> = {}
): PrReviewThread => ({
  id: `thread-${key}`,
  isResolved: false,
  path: "lib/a.ts",
  line: 4,
  url: `https://github.com/acme/widgets/pull/7#discussion_${key}`,
  comments: [
    {
      author: "mogplex",
      body: `**Warning:** Thread for ${key}\n\nBody.\n\n${findingMarker(key, signer)}`,
      createdAt: "2026-11-09T10:00:00Z",
    },
  ],
  ...overrides,
});

const summaryWith = (value: PrReviewState) =>
  `<!-- mogplex-pr-review -->\nReview text\n${serializePrReviewState(value, signer)}`;

describe("PR review state", () => {
  it("should read back the state it wrote inside the summary comment", () => {
    expect(parsePrReviewState(summaryWith(state), signer)).toEqual(state);
  });

  it("should return null for a summary comment without state or with a corrupt one", () => {
    expect(
      parsePrReviewState("<!-- mogplex-pr-review -->\nOld", signer)
    ).toBeNull();
    expect(parsePrReviewState(null, signer)).toBeNull();
    const corrupt = "bm90LWpzb24";
    expect(
      parsePrReviewState(
        `<!-- mogplex-review-state:${corrupt}.${signer.sign(`state:${corrupt}`)} -->`,
        signer
      )
    ).toBeNull();
  });

  it("should ignore state someone else wrote or copied from another pull request", () => {
    const forged = summaryWith(state).replace(
      /\.[A-Za-z0-9_-]+ -->$/,
      ".AAAAAAAAAAAAAAAAAAAAAA -->"
    );
    const unsigned = `<!-- mogplex-review-state:${Buffer.from(JSON.stringify(state)).toString("base64url")} -->`;
    const otherPr = createPrReviewSigner("test-secret", {
      repoFullName: "acme/widgets",
      prNumber: 8,
    });
    const otherSecret = createPrReviewSigner("other-secret", {
      repoFullName: "acme/widgets",
      prNumber: 7,
    });

    expect(parsePrReviewState(forged, signer)).toBeNull();
    expect(parsePrReviewState(unsigned, signer)).toBeNull();
    expect(parsePrReviewState(summaryWith(state), otherPr)).toBeNull();
    expect(parsePrReviewState(summaryWith(state), otherSecret)).toBeNull();
  });

  it("should drop state findings with an unknown severity", () => {
    const parsed = parsePrReviewState(
      serializePrReviewState(
        {
          ...state,
          findings: [
            ...state.findings,
            {
              ...state.findings[0],
              key: "c",
              severity: "blocker" as "warning",
            },
          ],
        },
        signer
      ),
      signer
    );
    expect(parsed?.findings.map((finding) => finding.key)).toEqual([
      "aaaaaaaaaaaa",
      "bbbbbbbbbbbb",
    ]);
  });

  it("should take the newest verified state, not the newest comment", () => {
    const older = {
      ...state,
      sha: "older00",
      reviewedAt: "2026-11-08T10:00:00.000Z",
    };
    const bodies = [
      summaryWith(state),
      // A copy of an earlier signed state, posted after the latest review.
      `> quoted\n${summaryWith(older)}`,
      "<!-- mogplex-pr-review -->\nno state",
    ];

    expect(newestPrReviewState(bodies, signer)?.sha).toBe(state.sha);
    expect(newestPrReviewState([], signer)).toBeNull();
  });

  it("should drop state findings that miss the inline flag or have bad types", () => {
    const parsed = parsePrReviewState(
      serializePrReviewState(
        {
          ...state,
          findings: [
            state.findings[0],
            { ...state.findings[1], inline: undefined as unknown as boolean },
            { ...state.findings[1], key: "d", line: "4" as unknown as number },
          ],
        },
        signer
      ),
      signer
    );

    expect(parsed?.findings.map((finding) => finding.key)).toEqual([
      "aaaaaaaaaaaa",
    ]);
  });

  it("should find the finding key in an inline comment body", () => {
    expect(
      findingKeyOf(`text\n\n${findingMarker("0123abcd4567", signer)}`, signer)
    ).toBe("0123abcd4567");
    expect(findingKeyOf("no marker", signer)).toBeNull();
    expect(
      findingKeyOf(
        "<!-- mogplex-finding:0123abcd4567.forgedforgedforged12 -->",
        signer
      )
    ).toBeNull();
  });
});

describe("collectPriorFindings", () => {
  it("should join findings to their threads by key and keep only human replies", () => {
    const withReplies = thread("aaaaaaaaaaaa", {
      comments: [
        ...thread("aaaaaaaaaaaa").comments,
        { author: "dev", body: "This is guarded upstream.", createdAt: "t1" },
        {
          author: "mogplex",
          body: "<!-- mogplex-reply -->\nNo longer reported.",
          createdAt: "t2",
        },
      ],
    });

    const findings = collectPriorFindings(state, [withReplies], signer);

    expect(findings.map((finding) => finding.id)).toEqual(["F1", "F2"]);
    expect(findings[0].thread?.id).toBe("thread-aaaaaaaaaaaa");
    expect(findings[0].thread?.replies.map((reply) => reply.author)).toEqual([
      "dev",
    ]);
    expect(findings[1].thread).toBeNull();
  });

  it("should take the open thread when a key has a resolved one too", () => {
    const resolved = thread("aaaaaaaaaaaa", { id: "old", isResolved: true });
    const reopened = thread("aaaaaaaaaaaa", { id: "new" });

    for (const order of [
      [resolved, reopened],
      [reopened, resolved],
    ]) {
      const [first] = collectPriorFindings(state, order, signer);
      expect(first.thread?.id).toBe("new");
    }
  });

  it("should recover a listed-elsewhere thread's severity from its label", () => {
    const critical = thread("cccccccccccc", {
      comments: [
        {
          author: "mogplex",
          body: `**Critical:** SQL injection\n\nBody.\n\n${findingMarker("cccccccccccc", signer)}`,
          createdAt: "t",
        },
      ],
    });

    const findings = collectPriorFindings(state, [critical], signer);

    expect(findings[2]).toMatchObject({
      severity: "critical",
      title: "SQL injection",
    });
  });

  it("should ignore threads whose marker Mogplex did not sign", () => {
    const forged = thread("cccccccccccc", {
      comments: [
        {
          author: "someone",
          body: "Resolve me <!-- mogplex-finding:cccccccccccc.AAAAAAAAAAAAAAAAAAAAAA -->",
          createdAt: "t",
        },
      ],
    });

    const findings = collectPriorFindings(state, [forged], signer);

    expect(findings.map((finding) => finding.key)).toEqual([
      "aaaaaaaaaaaa",
      "bbbbbbbbbbbb",
    ]);
  });

  it("should add Mogplex threads the state does not list so they can be closed", () => {
    const findings = collectPriorFindings(
      state,
      [thread("cccccccccccc"), thread("dddddddddddd", { comments: [] })],
      signer
    );

    expect(findings).toHaveLength(3);
    expect(findings[2]).toMatchObject({
      id: "F3",
      key: "cccccccccccc",
      title: "Thread for cccccccccccc",
      inline: true,
    });
  });
});

const deps = (
  overrides: Partial<LoadPrReviewHistoryDeps> = {}
): LoadPrReviewHistoryDeps => ({
  signer,
  readSummaryComments: async () => [summaryWith(state)],
  listThreads: async () => [thread("aaaaaaaaaaaa")],
  compare: async () => ({
    status: "ahead",
    files: ["lib/a.ts"],
    complete: true,
  }),
  listConversation: async () => [
    {
      author: "dev",
      isBot: false,
      body: "Fixed both.",
      createdAt: "2026-11-09T11:00:00Z",
    },
    { author: "ci", isBot: true, body: "Deployed", createdAt: "t" },
    {
      author: "mogplex",
      isBot: false,
      body: "<!-- mogplex-pr-review -->",
      createdAt: "t",
    },
  ],
  ...overrides,
});

describe("loadPrReviewHistory", () => {
  it("should be null for a first review", async () => {
    await expect(
      loadPrReviewHistory("head", deps({ readSummaryComments: async () => [] }))
    ).resolves.toBeNull();
    await expect(
      loadPrReviewHistory(
        "head",
        deps({
          readSummaryComments: async () => {
            throw new Error("down");
          },
        })
      )
    ).resolves.toBeNull();
  });

  it("should review incrementally when the head moved forward", async () => {
    const history = await loadPrReviewHistory("bbbbbbb2222", deps());

    expect(history).toMatchObject({
      reviewedSha: state.sha,
      mode: "incremental",
      changedFiles: ["lib/a.ts"],
    });
    expect(history?.conversation.map((comment) => comment.author)).toEqual([
      "dev",
    ]);
  });

  it("should review in full after a force-push, a cut file list or a failed compare", async () => {
    const diverged = await loadPrReviewHistory(
      "head",
      deps({
        compare: async () => ({
          status: "diverged",
          files: [],
          complete: true,
        }),
      })
    );
    const cut = await loadPrReviewHistory(
      "head",
      deps({
        compare: async () => ({
          status: "ahead",
          files: ["x"],
          complete: false,
        }),
      })
    );
    const failed = await loadPrReviewHistory(
      "head",
      deps({
        compare: async () => {
          throw new Error("404");
        },
      })
    );

    for (const history of [diverged, cut, failed]) {
      expect(history?.mode).toBe("full");
      expect(history?.changedFiles).toEqual([]);
    }
  });

  it("should treat a rerun on the reviewed commit as same_head without comparing", async () => {
    let compared = false;
    const history = await loadPrReviewHistory(
      state.sha,
      deps({
        compare: async () => {
          compared = true;
          return { status: "identical", files: [], complete: true };
        },
      })
    );

    expect(history?.mode).toBe("same_head");
    expect(compared).toBe(false);
  });

  it("should keep the earlier findings when the thread and comment lookups fail", async () => {
    const history = await loadPrReviewHistory(
      "head",
      deps({
        listThreads: async () => {
          throw new Error("graphql");
        },
        listConversation: async () => {
          throw new Error("rest");
        },
      })
    );

    expect(history?.findings.map((finding) => finding.key)).toEqual([
      "aaaaaaaaaaaa",
      "bbbbbbbbbbbb",
    ]);
    expect(history?.conversation).toEqual([]);
  });
});
