/**
 * Register a public SSH key as a GitHub *signing* key.
 *
 * GitHub only shows the "Verified" badge for commits signed with a key in
 * the account's SSH signing keys (`POST /user/ssh_signing_keys`), not for
 * the account's authentication keys (`POST /user/keys`). The endpoint needs
 * the `write:ssh_signing_key` scope, which a plain Mogplex OAuth grant does
 * not carry — so registration can legitimately fail while the commit itself
 * is still cryptographically signed.
 */
const SIGNING_KEYS_URL = "https://api.github.com/user/ssh_signing_keys";

export type SshSigningKeyRegistration =
  | { status: "registered"; keyId: string | null }
  | { status: "already_registered"; keyId: string | null }
  | { status: "scope_missing" }
  | { status: "rate_limited" }
  | { status: "failed"; message: string; httpStatus?: number };

export type GithubRequest = (
  input: string,
  init?: RequestInit
) => ReturnType<typeof fetch>;

export type GithubSigningKeyDeps = {
  request: GithubRequest;
};

const defaultDeps: GithubSigningKeyDeps = {
  request: ((input: string, init?: RequestInit) =>
    fetch(input, init)) as GithubRequest,
};

function requestHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "mogplex",
  };
}

function normalizePublicKey(key: string): string {
  return key.trim().split(/\s+/).slice(0, 2).join(" ");
}

function readKeyId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === "number" || typeof id === "string" ? String(id) : null;
}

function readMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export type GithubSshSigningKey = {
  id: string | null;
  title: string | null;
  publicKey: string | null;
};

export type GithubSigningKeyStatus =
  | { status: "registered"; keyId: string }
  | { status: "not_registered" }
  | { status: "unavailable" };

/**
 * Read the authenticated account's public signing keys. This does not need
 * SSH-key management permissions, so it also finds keys added on GitHub.
 * A refused or malformed lookup is unknown, never evidence of removal.
 */
export async function checkGithubSshSigningKey(
  input: { token: string; publicKey: string },
  deps: GithubSigningKeyDeps = defaultDeps
): Promise<GithubSigningKeyStatus> {
  const headers = requestHeaders(input.token);
  const signal = AbortSignal.timeout(15_000);
  const options = { headers, cache: "no-store" as const, signal };
  try {
    // Resolve identity from the token, never a browser-supplied or stale login.
    const identity = await deps.request("https://api.github.com/user", options);
    if (!identity.ok) return { status: "unavailable" };
    const account: unknown = await identity.json();
    const login =
      account && typeof account === "object" && "login" in account
        ? account.login
        : null;
    if (
      typeof login !== "string" ||
      !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(login)
    )
      return { status: "unavailable" };
    const normalized = normalizePublicKey(input.publicKey);
    for (let page = 1; ; page += 1) {
      const response = await deps.request(
        `https://api.github.com/users/${encodeURIComponent(login)}/ssh_signing_keys?per_page=100&page=${page}`,
        options
      );
      if (!response.ok) return { status: "unavailable" };
      const keys: unknown = await response.json();
      if (!Array.isArray(keys)) return { status: "unavailable" };
      for (const entry of keys) {
        if (
          !entry ||
          typeof entry !== "object" ||
          typeof entry.key !== "string" ||
          !readKeyId(entry)
        )
          return { status: "unavailable" };
        if (normalizePublicKey(entry.key) === normalized)
          return { status: "registered", keyId: readKeyId(entry)! };
      }
      if (keys.length < 100) return { status: "not_registered" };
    }
  } catch {
    return { status: "unavailable" };
  }
}

/** The signing keys already registered on the signed-in GitHub account. */
export async function listGithubSshSigningKeys(
  token: string,
  deps?: GithubSigningKeyDeps
): Promise<GithubSshSigningKey[]> {
  const request = deps?.request ?? defaultDeps.request;
  try {
    const keys: GithubSshSigningKey[] = [];
    for (let page = 1; ; page += 1) {
      const response = await request(
        `${SIGNING_KEYS_URL}?per_page=100&page=${page}`,
        {
          headers: requestHeaders(token),
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        }
      );
      if (!response.ok) return [];
      const body: unknown = await response.json().catch(() => null);
      if (!Array.isArray(body)) return [];
      keys.push(
        ...body.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const record = entry as {
            id?: unknown;
            title?: unknown;
            key?: unknown;
          };
          return [
            {
              id: readKeyId(record),
              title: typeof record.title === "string" ? record.title : null,
              publicKey: typeof record.key === "string" ? record.key : null,
            },
          ];
        })
      );
      if (body.length < 100) return keys;
    }
  } catch {
    return [];
  }
}

/**
 * Register the public key with GitHub.
 *
 * "already_registered" is a success case: the key is already on the account,
 * so commits signed with it get the Verified badge.
 */
export async function registerGithubSshSigningKey(
  input: { token: string; publicKey: string; title: string },
  deps?: GithubSigningKeyDeps
): Promise<SshSigningKeyRegistration> {
  const request = deps?.request ?? defaultDeps.request;
  let response: Response;
  try {
    response = await request(SIGNING_KEYS_URL, {
      method: "POST",
      headers: requestHeaders(input.token),
      body: JSON.stringify({ key: input.publicKey, title: input.title }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return {
      status: "failed",
      message:
        error instanceof Error ? error.message : "GitHub could not be reached.",
    };
  }

  const body: unknown = await response.json().catch(() => null);

  if (response.status === 201) {
    return { status: "registered", keyId: readKeyId(body) };
  }
  if (response.status === 422) {
    // A 422 can also reject an invalid key. Only claim registration when
    // the exact public key is present on this authenticated account.
    const normalized = normalizePublicKey(input.publicKey);
    const keys = await listGithubSshSigningKeys(input.token, { request });
    const existing = keys.find(
      (key) => normalizePublicKey(key.publicKey ?? "") === normalized
    );
    if (existing) return { status: "already_registered", keyId: existing.id };
  }
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after") ||
        /rate limit/i.test(readMessage(body, ""))))
  )
    return { status: "rate_limited" };
  if (
    (response.status === 403 && !response.headers.has("x-github-sso")) ||
    response.status === 404
  ) {
    // Missing signing-key permissions can also be hidden behind a 404.
    return { status: "scope_missing" };
  }
  return {
    status: "failed",
    httpStatus: response.status,
    message: readMessage(
      body,
      `GitHub refused the signing key (HTTP ${response.status}).`
    ),
  };
}
