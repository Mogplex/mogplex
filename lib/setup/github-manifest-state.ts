import crypto from "node:crypto";

/**
 * The `state` value round-tripped through GitHub's App manifest flow. It is
 * signed and bound to the user who started setup, so a manifest code can only
 * be redeemed by the same signed-in user, within the window GitHub keeps the
 * code alive (one hour).
 */
export const GITHUB_MANIFEST_STATE_TTL_SECONDS = 60 * 60;

type GithubManifestStatePayload = {
  userId: string;
  nonce: string;
  ts: number;
};

function sign(body: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

/** Signs a fresh state token for `userId`. */
export function signGithubManifestState(
  userId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): string {
  const payload: GithubManifestStatePayload = {
    userId,
    nonce: crypto.randomBytes(16).toString("base64url"),
    ts: nowSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

function parsePayload(body: string): GithubManifestStatePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { userId, nonce, ts } = parsed as Record<string, unknown>;
  if (
    typeof userId !== "string" ||
    typeof nonce !== "string" ||
    typeof ts !== "number"
  ) {
    return null;
  }
  return { userId, nonce, ts };
}

/**
 * True when `token` was signed with `secret` for `userId` and has not expired.
 */
export function verifyGithubManifestState(
  token: string | null | undefined,
  userId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
  const body = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(body, secret));
  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    return false;
  }

  const payload = parsePayload(body);
  if (payload?.userId !== userId) return false;
  if (nowSeconds - payload.ts > GITHUB_MANIFEST_STATE_TTL_SECONDS) return false;
  // Allow a minute of clock skew between app instances.
  return payload.ts - nowSeconds <= 60;
}
