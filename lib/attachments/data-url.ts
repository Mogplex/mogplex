import { ATTACHMENT_LIMITS } from "./policy";

export type AttachmentDataUrlFailure =
  | "invalid"
  | "data_url_too_long"
  | "file_too_large";

export function parseAttachmentDataUrl(
  url: string,
  mediaType: string
):
  | { ok: true; content: Buffer }
  | { ok: false; reason: AttachmentDataUrlFailure } {
  if (url.length > ATTACHMENT_LIMITS.maxDataUrlChars) {
    return { ok: false, reason: "data_url_too_long" };
  }
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);
  if (!match || match[1]?.toLowerCase() !== mediaType.toLowerCase()) {
    return { ok: false, reason: "invalid" };
  }
  const encodedData = match[2] ?? "";
  if (encodedData.length % 4 !== 0) {
    return { ok: false, reason: "invalid" };
  }
  const content = Buffer.from(encodedData, "base64");
  if (content.toString("base64") !== encodedData) {
    return { ok: false, reason: "invalid" };
  }
  if (content.byteLength > ATTACHMENT_LIMITS.maxFileBytes) {
    return { ok: false, reason: "file_too_large" };
  }
  return { ok: true, content };
}

export function checkAttachmentBudget(
  budget: { count: number; bytes: number },
  decodedBytes: number
): { ok: true } | { ok: false; reason: "count" | "total" } {
  if (budget.count + 1 > ATTACHMENT_LIMITS.maxFiles) {
    return { ok: false, reason: "count" };
  }
  if (budget.bytes + decodedBytes > ATTACHMENT_LIMITS.maxTotalBytes) {
    return { ok: false, reason: "total" };
  }
  budget.count += 1;
  budget.bytes += decodedBytes;
  return { ok: true };
}
