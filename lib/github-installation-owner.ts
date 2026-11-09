import {
  createGithubInstallationAccessToken,
  type GithubInstallation,
} from "@/lib/github-app";

const defaultDeps = {
  createInstallationAccessToken: createGithubInstallationAccessToken,
  request: ((input, init) => fetch(input, init)) as typeof fetch,
};

/**
 * The login GitHub reports for the identity token right now. A stored login
 * can go stale after a rename, and GitHub may hand the old name to someone
 * else, so authorization never trusts it.
 */
export async function fetchGithubIdentityLogin(
  identityToken: string | null | undefined,
  request: typeof fetch = (input, init) => fetch(input, init)
): Promise<string | null> {
  if (!identityToken) return null;
  const response = await request("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${identityToken}`,
      Accept: "application/vnd.github+json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if ([401, 403, 404].includes(response.status)) return null;
  if (!response.ok)
    throw new Error(
      `GitHub identity could not be verified (${response.status})`
    );
  const identity: unknown = await response.json();
  const login = (identity as { login?: unknown } | null)?.login;
  return typeof login === "string" && login.trim() ? login : null;
}

/**
 * A user may attach an installation when it is on their own account or on an
 * org they belong to. Which members see which repos is the org's call: it
 * picks the installation's repository set. Membership is checked with the
 * installation token, so orgs that restrict OAuth apps still verify.
 */
export async function verifyGithubInstallationMember(
  installation: GithubInstallation,
  githubLogin: string | null | undefined,
  overrides: Partial<typeof defaultDeps> = {}
): Promise<boolean> {
  const deps = { ...defaultDeps, ...overrides };
  const owner = installation.account?.login;
  const kind = installation.account?.type;
  const login = githubLogin?.trim();
  if (!owner || !login) return false;
  if (kind === "User") return login.toLowerCase() === owner.toLowerCase();
  if (kind !== "Organization") return false;

  const { token } = await deps.createInstallationAccessToken(installation.id);
  const response = await deps.request(
    `https://api.github.com/orgs/${encodeURIComponent(owner)}/members/${encodeURIComponent(login)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (response.status === 204) return true;
  if ([302, 404].includes(response.status)) return false;
  throw new Error(
    `GitHub org membership could not be verified (${response.status})`
  );
}
