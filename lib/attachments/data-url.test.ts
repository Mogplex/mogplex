import { describe, expect, it, vi } from "vitest";
import {
  parseAttachmentDataUrl,
  readAttachmentDataUrlByteLength,
} from "./data-url";

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

describe("readAttachmentDataUrlByteLength", () => {
  it("validates size without allocating decoded content", () => {
    const from = vi.spyOn(Buffer, "from");
    try {
      expect(
        readAttachmentDataUrlByteLength(
          "data:text/plain;base64,aGVsbG8=",
          "text/plain"
        )
      ).toEqual({ ok: true, byteLength: 5 });
      expect(from).not.toHaveBeenCalled();
    } finally {
      from.mockRestore();
    }
  });

  it.each([
    "data:text/plain;base64,aGVsbG8",
    "data:text/plain;base64,aGVsbG9=",
  ])("rejects non-canonical input %s without decoding", (url) => {
    expect(readAttachmentDataUrlByteLength(url, "text/plain")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
