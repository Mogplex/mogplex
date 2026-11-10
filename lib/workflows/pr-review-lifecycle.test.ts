import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "@/lib/types";
import type { PrReviewHistory, PriorFinding } from "./pr-review-history";
import {
  MOGPLEX_REPLY_MARKER,
  assignFindingKeys,
  planPrReviewThreads,
} from "./pr-review-lifecycle";

const finding = (
  title: string,
  overrides: Partial<ReviewFinding> = {}
): ReviewFinding => ({
  severity: "warning",
  title,
  body: `${title} body.`,
  path: "lib/a.ts",
  line: 4,
  ...overrides,
});

const prior = (
  id: string,
  key: string,
  thread: PriorFinding["thread"]
): PriorFinding => ({
  id,
  key,
  severity: "warning",
  title: `Prior ${id}`,
  path: "lib/a.ts",
  line: 4,
  inline: thread != null,
  thread,
});

const openThread = (id: string) => ({
  id,
  url: `https://github.com/t/${id}`,
  isResolved: false,
  replies: [],
});

const history = (findings: PriorFinding[]): PrReviewHistory => ({
  reviewedSha: "old",
  reviewedAt: "2026-11-09T10:00:00.000Z",
  mode: "full",
  changedFiles: [],
  findings,
  threadsLoaded: true,
  conversation: [],
});

describe("assignFindingKeys", () => {
  it("should give the same finding the same key on every run", () => {
    const first = assignFindingKeys([finding("A")], null);
    const second = assignFindingKeys([finding("A", { line: 40 })], null);

    expect([...first.values()][0]).toMatch(/^[a-f0-9]{12}$/);
    expect([...second.values()][0]).toBe([...first.values()][0]);
  });

  it("should reuse an earlier finding's key through priorId, once", () => {
    const earlier = history([prior("F1", "aaaaaaaaaaaa", null)]);
    const reworded = finding("Reworded", { priorId: "F1" });
    const copy = finding("Copy", { priorId: "F1" });
    const unknown = finding("Unknown", { priorId: "F9" });

    const keys = assignFindingKeys([reworded, copy, unknown], earlier);

    expect(keys.get(reworded)).toBe("aaaaaaaaaaaa");
    expect(keys.get(copy)).not.toBe("aaaaaaaaaaaa");
    expect(keys.get(unknown)).toMatch(/^[a-f0-9]{12}$/);
  });

  it("should ignore a priorId that points at another file", () => {
    const earlier = history([prior("F1", "aaaaaaaaaaaa", null)]);
    const elsewhere = finding("Other file", {
      priorId: "F1",
      path: "lib/b.ts",
    });

    const keys = assignFindingKeys([elsewhere], earlier);

    expect(keys.get(elsewhere)).not.toBe("aaaaaaaaaaaa");
  });

  it("should keep the key of a finding reported again without its priorId", () => {
    const earlier = history([prior("F1", "aaaaaaaaaaaa", openThread("t1"))]);
    const reworded = finding("  prior f1 ", { body: "New wording." });

    const keys = assignFindingKeys([reworded], earlier);
    const plan = planPrReviewThreads({
      history: earlier,
      keys,
      headSha: "1234567890",
      complete: true,
    });

    expect(keys.get(reworded)).toBe("aaaaaaaaaaaa");
    expect(plan.existingThreads.has(reworded)).toBe(true);
    expect(plan.resolve).toEqual([]);
  });

  it("should keep keys unique when two findings have the same content", () => {
    const keys = assignFindingKeys([finding("Same"), finding("Same")], null);

    expect(new Set(keys.values()).size).toBe(2);
  });
});

describe("planPrReviewThreads", () => {
  const reported = finding("Still there");
  const keys = new Map([[reported, "aaaaaaaaaaaa"]]);
  const earlier = history([
    prior("F1", "aaaaaaaaaaaa", openThread("t1")),
    prior("F2", "bbbbbbbbbbbb", openThread("t2")),
    prior("F3", "cccccccccccc", { ...openThread("t3"), isResolved: true }),
    prior("F4", "dddddddddddd", null),
  ]);

  it("should keep the thread of a finding reported again", () => {
    const plan = planPrReviewThreads({
      history: earlier,
      keys,
      headSha: "1234567890",
      complete: true,
    });

    expect(plan.existingThreads.get(reported)).toBe("https://github.com/t/t1");
  });

  it("should resolve open threads of findings no longer reported", () => {
    const plan = planPrReviewThreads({
      history: earlier,
      keys,
      headSha: "1234567890",
      complete: true,
    });

    expect(plan.resolve).toEqual([
      {
        threadId: "t2",
        body: `${MOGPLEX_REPLY_MARKER}\nNo longer reported at \`1234567\`.`,
      },
    ]);
    expect(plan.resolvedFindings.map((entry) => entry.id)).toEqual([
      "F2",
      "F3",
      "F4",
    ]);
  });

  it("should post a finding inline again when a person resolved its thread", () => {
    const reopened = finding("Back again");
    const plan = planPrReviewThreads({
      history: earlier,
      keys: new Map([[reopened, "cccccccccccc"]]),
      headSha: "1234567890",
      complete: true,
    });

    expect(plan.existingThreads.has(reopened)).toBe(false);
    expect(plan.resolve.map((entry) => entry.threadId)).toEqual(["t1", "t2"]);
  });

  it("should close nothing when the report is incomplete or may be cut", () => {
    const plan = planPrReviewThreads({
      history: earlier,
      keys,
      headSha: "1234567890",
      complete: false,
    });

    expect(plan.resolve).toEqual([]);
    expect(plan.resolvedFindings).toEqual([]);
    expect(plan.existingThreads.size).toBe(1);
  });

  it("should close only findings in changed files on an incremental review", () => {
    const elsewhere = {
      ...prior("F2", "bbbbbbbbbbbb", openThread("t2")),
      path: "lib/untouched.ts",
    };
    const changedHere = prior("F5", "eeeeeeeeeeee", openThread("t5"));
    const plan = planPrReviewThreads({
      history: {
        ...history([elsewhere, changedHere]),
        mode: "incremental",
        changedFiles: ["lib/a.ts"],
      },
      keys: new Map(),
      headSha: "1234567890",
      complete: true,
    });

    expect(plan.resolve.map((entry) => entry.threadId)).toEqual(["t5"]);
    expect(plan.resolvedFindings.map((entry) => entry.id)).toEqual(["F5"]);
  });

  it("should neither post again nor close anything when the threads could not be read", () => {
    const inlineBefore = finding("Inline before");
    const summaryOnly = finding("Summary only");
    const plan = planPrReviewThreads({
      history: {
        ...history([
          { ...prior("F1", "aaaaaaaaaaaa", null), inline: true },
          prior("F2", "bbbbbbbbbbbb", null),
          { ...prior("F3", "cccccccccccc", null), inline: true },
        ]),
        threadsLoaded: false,
      },
      keys: new Map([
        [inlineBefore, "aaaaaaaaaaaa"],
        [summaryOnly, "bbbbbbbbbbbb"],
      ]),
      headSha: "1234567890",
      complete: true,
    });

    expect([...plan.existingThreads]).toEqual([[inlineBefore, null]]);
    expect(plan.resolve).toEqual([]);
    expect(plan.resolvedFindings).toEqual([]);
  });

  it("should plan nothing for a first review", () => {
    const plan = planPrReviewThreads({
      history: null,
      keys,
      headSha: "1234567890",
      complete: true,
    });

    expect(plan.existingThreads.size).toBe(0);
    expect(plan.resolve).toEqual([]);
  });
});
