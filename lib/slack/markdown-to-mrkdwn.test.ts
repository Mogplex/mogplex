import { describe, expect, it } from "vitest";
import { markdownToMrkdwn } from "./markdown-to-mrkdwn";

describe("markdownToMrkdwn", () => {
  it("should convert emphasis to Slack's markers", () => {
    expect(
      markdownToMrkdwn("**Fixed** the *flaky* test, ~~not~~ __really__")
    ).toBe("*Fixed* the _flaky_ test, ~not~ *really*");
  });

  it("should turn headings into bold lines and bullets into dots", () => {
    expect(
      markdownToMrkdwn(
        "## Summary\n- one\n  * nested\n+ two\n---\n### **Next**"
      )
    ).toBe("*Summary*\n• one\n  • nested\n• two\n*Next*");
  });

  it("should keep a link's URL visible instead of hiding it behind a label", () => {
    expect(
      markdownToMrkdwn(
        "See [PR #12](https://github.com/acme/app/pull/12) and <https://example.com/a>"
      )
    ).toBe(
      "See PR #12 (https://github.com/acme/app/pull/12) and https://example.com/a"
    );
  });

  it("should escape text that would otherwise mention a channel or forge a link", () => {
    expect(
      markdownToMrkdwn("Done <!channel> <https://evil.test|Approved> & more")
    ).toBe(
      "Done &lt;!channel&gt; &lt;https://evil.test|Approved&gt; &amp; more"
    );
  });

  it("should leave code spans and fenced code unformatted", () => {
    expect(
      markdownToMrkdwn("Run `pnpm **test**`\n```ts\nconst a = b && c;\n```")
    ).toBe("Run `pnpm **test**`\n```\nconst a = b &amp;&amp; c;\n```");
  });

  it("should close a code fence cut off by an excerpt", () => {
    expect(markdownToMrkdwn("Output:\n```\nline")).toBe(
      "Output:\n```\nline\n```"
    );
  });

  it("should flatten tables into readable rows", () => {
    expect(
      markdownToMrkdwn("| Check | Result |\n|---|:---:|\n| lint | **pass** |")
    ).toBe("Check · Result\nlint · *pass*");
  });

  it("should keep block quotes as Slack quotes", () => {
    expect(markdownToMrkdwn("> note **this**")).toBe("> note *this*");
  });

  it("should collapse blank runs in prose but keep them inside code", () => {
    expect(markdownToMrkdwn("one\n\n\n\ntwo\n```\na\n\n\nb\n```")).toBe(
      "one\n\ntwo\n```\na\n\n\nb\n```"
    );
  });

  it("should defuse bare broadcast mentions", () => {
    expect(markdownToMrkdwn("Done @channel, @HERE and @everyone")).toBe(
      "Done @\u200Bchannel, @\u200BHERE and @\u200Beveryone"
    );
  });
});
