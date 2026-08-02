import crypto from "node:crypto";

export const SLACK_SIGNATURE_VERSION = "v0";
export const SLACK_SIGNATURE_TIMESTAMP_HEADER = "x-slack-request-timestamp";
export const SLACK_SIGNATURE_HEADER = "x-slack-signature";

/**
 * Maximum age (seconds) of a Slack request before we treat it as a replay.
 * Slack themselves recommend rejecting anything older than five minutes.
 */
export const SLACK_SIGNATURE_MAX_AGE_SECONDS = 60 * 5;

export type VerifySlackSignatureInput = {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  signingSecret: string;
  /** Override for `Date.now()` — only used by tests. */
  now?: () => number;
};

/**
 * Verify an incoming Slack request signature.
 *
 * Slack signs requests as `v0=HMAC_SHA256(signing_secret, "v0:{timestamp}:{rawBody}")`.
 * The raw body must be the exact bytes Slack sent — read it via `req.text()` before
 * parsing, never re-serialise a parsed JSON object.
 *
 * Returns `false` (never throws) for any malformed input so callers can respond 401
 * without leaking which check failed.
 */
export function verifySlackSignature(
  input: VerifySlackSignatureInput
): boolean {
  const { rawBody, timestamp, signature, signingSecret } = input;
  if (!timestamp || !signature || !signingSecret) return false;

  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) return false;

  const nowSeconds = Math.floor((input.now ?? Date.now)() / 1000);
  if (
    Math.abs(nowSeconds - timestampSeconds) > SLACK_SIGNATURE_MAX_AGE_SECONDS
  ) {
    return false;
  }

  const baseString = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const expected = `${SLACK_SIGNATURE_VERSION}=${crypto
    .createHmac("sha256", signingSecret)
    .update(baseString)
    .digest("hex")}`;

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

/**
 * Convenience helper that pulls the standard Slack headers off a `Headers` object.
 */
export function verifySlackRequest(input: {
  headers: Pick<Headers, "get">;
  rawBody: string;
  signingSecret: string;
  now?: () => number;
}): boolean {
  return verifySlackSignature({
    rawBody: input.rawBody,
    timestamp: input.headers.get(SLACK_SIGNATURE_TIMESTAMP_HEADER),
    signature: input.headers.get(SLACK_SIGNATURE_HEADER),
    signingSecret: input.signingSecret,
    now: input.now,
  });
}
