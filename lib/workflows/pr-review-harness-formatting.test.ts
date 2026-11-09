import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "@/lib/types";
import { buildReviewFindingsSections } from "./pr-review-harness-formatting";

const finding = (title: string, body: string): ReviewFinding => ({
  severity: "warning",
  title,
  body,
  path: "src/a.ts",
  line: 3,
});

describe("buildReviewFindingsSections", () => {
  it("should keep this review's body under the link of a finding an earlier review threaded", () => {
    const carried = finding("Still open", "Answer: the retry path skips it.");
    const posted = finding("New one", "Posted inline this run.");

    const [warnings] = buildReviewFindingsSections([carried, posted], {
      links: new Map([
        [carried, "https://github.com/acme/widgets/pull/7#discussion_1"],
        [posted, "https://github.com/acme/widgets/pull/7#pullrequestreview-2"],
      ]),
      carried: new Set([carried]),
    });

    expect(warnings).toContain(
      "- **Still open** (`src/a.ts:L3`): [inline comment](https://github.com/acme/widgets/pull/7#discussion_1)\n  Answer: the retry path skips it."
    );
    expect(warnings).not.toContain("Posted inline this run.");
  });
});
