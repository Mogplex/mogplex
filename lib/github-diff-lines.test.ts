import { describe, expect, it } from "vitest";
import { parsePatchRightLines } from "./github-diff-lines";

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

  it("should stop at the end of each hunk when the patch ends in a newline", () => {
    expect(parsePatchRightLines("@@ -1,1 +1,2 @@\n a\n+b\n")).toEqual([1, 2]);
    expect(parsePatchRightLines("@@ -3 +3 @@\n-x\n+y\n")).toEqual([3]);
  });

  it("should list no lines for a deleted file", () => {
    expect(parsePatchRightLines("@@ -1,2 +0,0 @@\n-a\n-b")).toEqual([]);
  });
});
