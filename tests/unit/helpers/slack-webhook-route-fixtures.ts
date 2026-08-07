import crypto from "node:crypto";

// Deterministic test fixture - clearly synthetic, not a real Slack secret.
export const SIGNING_SECRET = ["test", "slack", "signing", "secret"].join("-");

export async function loadSlackWebhookRoute() {
  process.env.SLACK_SIGNING_SECRET ||= SIGNING_SECRET;
  return import("../../../app/api/webhooks/slack/route");
}

export function signedHeaders(
  rawBody: string,
  opts: { contentType?: string } = {}
) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const base = `v0:${timestamp}:${rawBody}`;
  const signature = `v0=${crypto
    .createHmac("sha256", SIGNING_SECRET)
    .update(base)
    .digest("hex")}`;
  const headers: Record<string, string> = {
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": signature,
  };
  if (opts.contentType) headers["content-type"] = opts.contentType;
  return headers;
}
