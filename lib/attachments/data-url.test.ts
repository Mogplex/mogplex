import { describe, expect, it } from "vitest";
import { parseAttachmentDataUrl } from "./data-url";

describe("parseAttachmentDataUrl", () => {
  it("decodes a canonical attachment", () => {
    const result = parseAttachmentDataUrl(
      "data:text/plain;base64,aGVsbG8=",
      "text/plain"
    );
    expect(result).toEqual({ ok: true, content: Buffer.from("hello") });
  });

  it.each([
    ["data:text/plain;base64,aGVsbG8", "text/plain", "non-multiple-of-four"],
    [
      "data:text/plain;base64,aGVsbG8===",
      "text/plain",
      "non-canonical padding",
    ],
    ["data:text/plain;base64,aGVsbG8=", "text/markdown", "media mismatch"],
  ])("rejects %s", (url, mediaType, _description) => {
    expect(parseAttachmentDataUrl(url, mediaType)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects oversized data URLs and decoded files", () => {
    expect(
      parseAttachmentDataUrl(
        `data:text/plain;base64,${"A".repeat(5_600_001)}`,
        "text/plain"
      )
    ).toEqual({ ok: false, reason: "data_url_too_long" });
    expect(
      parseAttachmentDataUrl(
        `data:text/plain;base64,${Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64")}`,
        "text/plain"
      )
    ).toEqual({ ok: false, reason: "file_too_large" });
  });
});
