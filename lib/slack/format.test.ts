import { describe, expect, it } from "vitest";
import {
  fitSlackMessageText,
  formatSlackConversationalReply,
  SLACK_MESSAGE_TEXT_MAX_CHARS,
} from "./format";

describe("formatSlackConversationalReply", () => {
  it("should convert Markdown links and bold into Slack mrkdwn", () => {
    expect(
      formatSlackConversationalReply(
        "See [the run](https://app.test/r/1) **now**"
      )
    ).toBe("See <https://app.test/r/1|the run> *now*");
  });

  it("should strip characters that would break a Slack link label", () => {
    expect(formatSlackConversationalReply("[a|b<c>](https://app.test/x)")).toBe(
      "<https://app.test/x|abc>"
    );
  });
});

describe("fitSlackMessageText", () => {
  it("should leave short text untouched", () => {
    expect(fitSlackMessageText("hello")).toBe("hello");
  });

  it("should truncate long text to the Slack limit with a notice", () => {
    const fitted = fitSlackMessageText(
      "x".repeat(SLACK_MESSAGE_TEXT_MAX_CHARS + 50)
    );
    expect(Array.from(fitted).length).toBe(SLACK_MESSAGE_TEXT_MAX_CHARS);
    expect(fitted).toMatch(/Response shortened to fit Slack/);
  });
});
