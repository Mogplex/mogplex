import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "@/lib/types";
import {
  anchorReviewFindings,
  parsePatchRightLines,
} from "./pr-review-anchors";

const finding = (
  path: string | null,
  line: number | null,
  title = "Issue"
): ReviewFinding => ({ severity: "warning", title, body: "Body.", path, line });

describe("parsePatchRightLines", () => {
  it("should list the new-file lines of context and added rows across hunks", () => {
    const patch = [
      "@@ -1,3 +1,4 @@",
      " keep",
      "-removed",
      "+added one",
      "+added two",
      " tail",
      "\\ No newline at end of file",
      "@@ -40,2 +41,2 @@ function x() {",
      "-old",
      "+new",
      " end",
    ].join("\n");

    expect(parsePatchRightLines(patch)).toEqual([1, 2, 3, 4, 41, 42]);
  });
});

describe("anchorReviewFindings", () => {
  const changed = new Map([
    ["src/a.ts", [10, 11, 12, 30]],
    ["assets/logo.png", []],
  ]);

  it("should keep a line the diff shows and move others to the nearest changed line", () => {
    const { comments, unanchored } = anchorReviewFindings(
      [
        finding("src/a.ts", 11, "exact"),
        finding("src/a.ts", 25, "nearest"),
        finding("src/a.ts", null, "file"),
      ],
      changed
    );

    expect(comments.map((c) => [c.finding.title, c.line, c.anchor])).toEqual([
      ["exact", 11, "exact"],
      ["nearest", 30, "nearest"],
      ["file", 10, "file"],
    ]);
    expect(unanchored).toEqual([]);
  });

  it("should leave findings the diff cannot carry for the summary", () => {
    const outside = finding("src/untouched.ts", 5);
    const binary = finding("assets/logo.png", 1);
    const noPath = finding(null, null);

    const { comments, unanchored } = anchorReviewFindings(
      [outside, binary, noPath],
      changed
    );

    expect(comments).toEqual([]);
    expect(unanchored).toEqual([outside, binary, noPath]);
  });

  it("should anchor only findings with a path and line when the diff is unknown", () => {
    const named = finding("src/a.ts", 99);
    const lineless = finding("src/a.ts", null);

    const { comments, unanchored } = anchorReviewFindings(
      [named, lineless],
      null
    );

    expect(comments.map((c) => [c.line, c.anchor])).toEqual([[99, "exact"]]);
    expect(unanchored).toEqual([lineless]);
  });
});
