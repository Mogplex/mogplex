import crypto from "node:crypto";
import { buildAppUrl } from "@/lib/app-url";

/**
 * Bot scopes Mogplex requests from Slack. Must match the app manifest's
 * `oauth_config.scopes.bot` list so reinstalls don't surprise users.
 */
export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "mpim:read",
  "users:read",
  // Required for `users.info` to return the `email` field — that's how Slack
  // users get lazily mapped to Mogplex profiles. Without it conversational mode
  // never resolves a user. Existing installs must re-auth to pick this up.
  "users:read.email",
] as const;

export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_OAUTH_ACCESS_URL = "https://slack.com/api/oauth.v2.access";
export const SLACK_OAUTH_STATE_COOKIE = "slack_oauth_state";

/**
 * State tokens older than this on the callback are rejected. Keeps the
 * install-flow window small enough that a stolen state nonce expires before
 * an attacker can replay it.
 */
export const SLACK_OAUTH_STATE_TTL_SECONDS = 10 * 60;

export type SlackOAuthStatePayload = {
  userId: string;
  nonce: string;
  ts: number; // unix seconds
};

export type SlackOAuthAccessResponse = {
  ok: boolean;
  error?: string;
  access_token?: string;
  bot_user_id?: string;
  scope?: string;
  team?: { id: string; name?: string };
  authed_user?: { id: string };
  app_id?: string;
};

export type SlackOAuthConfig = {
  clientId: string;
  clientSecret: string;
  signingSecret: string;
  redirectUri: string;
};

export function getSlackOAuthConfig(
  request?: Request
): SlackOAuthConfig | null {
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!clientId || !clientSecret || !signingSecret) return null;

  const overrideRedirect = process.env.SLACK_REDIRECT_URI?.trim();
  const redirectUri = overrideRedirect
    ? overrideRedirect
    : buildAppUrl("/api/integrations/slack/callback", request).toString();

  return { clientId, clientSecret, signingSecret, redirectUri };
}

/**
 * Sign a state payload with the Slack signing secret. We reuse the signing
 * secret here rather than introducing a new key — it's already a
 * service-managed HMAC secret and rotating Slack credentials is the only event
 * that should invalidate in-flight OAuth states.
 */
export function signSlackOAuthState(
  payload: SlackOAuthStatePayload,
  signingSecret: string
): string {
  const body = base64UrlEncode(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", signingSecret).update(body).digest();
  return `${body}.${base64UrlEncode(mac)}`;
}

function splitStateToken(token: string): { body: string; mac: string } | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  return { body: token.slice(0, dot), mac: token.slice(dot + 1) };
}

function macsMatch(providedMac: string, expectedMac: string): boolean {
  const providedBuf = Buffer.from(providedMac);
  const expectedBuf = Buffer.from(expectedMac);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

function parseStatePayload(body: string): SlackOAuthStatePayload | null {
  let parsed: SlackOAuthStatePayload;
  try {
    parsed = JSON.parse(base64UrlDecode(body)) as SlackOAuthStatePayload;
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed.userId !== "string" ||
    typeof parsed.nonce !== "string" ||
    typeof parsed.ts !== "number"
  ) {
    return null;
  }
  return parsed;
}

function isStateTimestampFresh(
  ts: number,
  nowSeconds: number,
  ttlSeconds: number
): boolean {
  if (nowSeconds - ts > ttlSeconds) return false;
  // Small clock-skew tolerance — Slack does the same on its end.
  if (ts - nowSeconds > 60) return false;
  return true;
}

export function verifySlackOAuthState(
  token: string,
  signingSecret: string,
  now: () => number = Date.now
): SlackOAuthStatePayload | null {
  const split = splitStateToken(token);
  if (!split) return null;

  const expectedMac = base64UrlEncode(
    crypto.createHmac("sha256", signingSecret).update(split.body).digest()
  );
  if (!macsMatch(split.mac, expectedMac)) return null;

  const parsed = parseStatePayload(split.body);
  if (!parsed) return null;

  const nowSeconds = Math.floor(now() / 1000);
  if (
    !isStateTimestampFresh(parsed.ts, nowSeconds, SLACK_OAUTH_STATE_TTL_SECONDS)
  ) {
    return null;
  }
  return parsed;
}

export function buildSlackAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    scope: (input.scopes ?? SLACK_BOT_SCOPES).join(","),
    redirect_uri: input.redirectUri,
    state: input.state,
  });
  return `${SLACK_AUTHORIZE_URL}?${params.toString()}`;
}

export type ExchangeSlackCodeDeps = {
  fetchImpl?: typeof fetch;
};

export async function exchangeSlackCode(
  input: {
    code: string;
    config: SlackOAuthConfig;
  },
  deps: ExchangeSlackCodeDeps = {}
): Promise<SlackOAuthAccessResponse> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    redirect_uri: input.config.redirectUri,
  });

  let response: Response;
  try {
    response = await fetchImpl(SLACK_OAUTH_ACCESS_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    return { ok: false, error: "request_failed" };
  }

  // Slack returns 200 with `ok: false` on logical failures; we still parse JSON.
  if (!response.ok) {
    return { ok: false, error: `http_${response.status}` };
  }

  try {
    return (await response.json()) as SlackOAuthAccessResponse;
  } catch {
    return { ok: false, error: "invalid_response" };
  }
}

function base64UrlEncode(value: string | Buffer): string {
  const buf = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value: string): string {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}
