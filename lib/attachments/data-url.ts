import { ATTACHMENT_LIMITS } from "./policy";

export type AttachmentDataUrlFailure =
  | "invalid"
  | "data_url_too_long"
  | "file_too_large";

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function readAttachmentDataUrlMetadata(
  url: string,
  mediaType: string
):
  | { ok: true; encodedData: string; byteLength: number }
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

  const padding = encodedData.endsWith("==")
    ? 2
    : encodedData.endsWith("=")
      ? 1
      : 0;
  const unusedBits = padding === 2 ? 4 : padding === 1 ? 2 : 0;
  if (unusedBits > 0) {
    const lastValue = BASE64_ALPHABET.indexOf(
      encodedData[encodedData.length - padding - 1] ?? ""
    );
    if (lastValue === -1 || (lastValue & ((1 << unusedBits) - 1)) !== 0) {
      return { ok: false, reason: "invalid" };
    }
  }

  const byteLength = (encodedData.length / 4) * 3 - padding;
  if (byteLength > ATTACHMENT_LIMITS.maxFileBytes) {
    return { ok: false, reason: "file_too_large" };
  }
  return { ok: true, encodedData, byteLength };
}

// Size validation uses the same canonical-base64 contract as full decoding,
// without allocating or re-encoding the attachment content.
export function readAttachmentDataUrlByteLength(
  url: string,
  mediaType: string
):
  | { ok: true; byteLength: number }
  | { ok: false; reason: AttachmentDataUrlFailure } {
  const parsed = readAttachmentDataUrlMetadata(url, mediaType);
  if (!parsed.ok) return parsed;
  return { ok: true, byteLength: parsed.byteLength };
}

export function parseAttachmentDataUrl(
  url: string,
  mediaType: string
):
  | { ok: true; content: Buffer }
  | { ok: false; reason: AttachmentDataUrlFailure } {
  const parsed = readAttachmentDataUrlMetadata(url, mediaType);
  if (!parsed.ok) return parsed;
  return { ok: true, content: Buffer.from(parsed.encodedData, "base64") };
}

export function chargeAttachmentBudget(
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
