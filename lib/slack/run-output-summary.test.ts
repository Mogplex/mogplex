import { describe, expect, it } from "vitest";
import {
  buildRepoAgentRunResultText,
  extractPullRequestUrls,
  SLACK_RUN_SUMMARY_MAX_CHARS,
} from "./run-output-summary";

describe("extractPullRequestUrls", () => {
  it("should return unique pull request URLs in order", () => {
    expect(
      extractPullRequestUrls(
        "Opened https://github.com/acme/widgets/pull/12 and again https://github.com/acme/widgets/pull/12 then https://github.com/acme/api/pull/3"
      )
    ).toEqual([
      "https://github.com/acme/widgets/pull/12",
      "https://github.com/acme/api/pull/3",
    ]);
  });

  it("should ignore issue and repo URLs", () => {
    expect(
      extractPullRequestUrls(
        "https://github.com/acme/widgets/issues/9 https://github.com/acme/widgets"
      )
    ).toEqual([]);
  });
});

describe("buildRepoAgentRunResultText", () => {
  it("should link opened pull requests and include the agent's closing output", () => {
    const text = buildRepoAgentRunResultText({
      statusLine: ":white_check_mark: Run `run-1` finished",
      output:
        "Fixed the null read.\n\nOpened [PR #12](https://github.com/acme/widgets/pull/12) **ready for review**.",
    });
    expect(text).toContain(":white_check_mark: Run `run-1` finished");
    expect(text).toContain(
      "*Pull request:* <https://github.com/acme/widgets/pull/12|acme/widgets#12>"
    );
    expect(text).toContain(
      "<https://github.com/acme/widgets/pull/12|PR #12> *ready for review*"
    );
  });

  it("should keep only the status line when there is no output", () => {
    expect(
      buildRepoAgentRunResultText({ statusLine: "done", output: null })
    ).toBe("done");
  });

  it("should keep the tail of long output", () => {
    const output = `${"a".repeat(SLACK_RUN_SUMMARY_MAX_CHARS)}END`;
    const text = buildRepoAgentRunResultText({ statusLine: "done", output });
    expect(text.endsWith("END")).toBe(true);
    expect(text).toContain("…");
    expect(text).not.toContain("a".repeat(SLACK_RUN_SUMMARY_MAX_CHARS));
  });
});
