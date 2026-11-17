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
  | { status: "failed"; message: string };

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
    const normalized = input.publicKey
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(" ");
    const keys = await listGithubSshSigningKeys(input.token, { request });
    const existing = keys.find(
      (key) =>
        key.publicKey?.trim().split(/\s+/).slice(0, 2).join(" ") === normalized
    );
    if (existing) return { status: "already_registered", keyId: existing.id };
  }
  if (response.status === 403) {
    // The token is missing write:ssh_signing_key, or SSO blocked the call.
    return { status: "scope_missing" };
  }
  return {
    status: "failed",
    message: readMessage(
      body,
      `GitHub refused the signing key (HTTP ${response.status}).`
    ),
  };
}
