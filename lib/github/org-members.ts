import {
  GithubHttpError,
  createGithubInstallationAccessToken,
  githubInstallationFetch,
} from "@/lib/github-app";

export type GithubOrgMember = {
  login: string;
  email: string | null;
};

type SimpleUser = { login: string };
type GithubUser = { login: string; email: string | null };

const MAX_PAGES = 10;
const PAGE_SIZE = 100;
const USER_LOOKUP_CONCURRENCY = 20;

export type ListGithubOrgMembersDeps = {
  createInstallationAccessToken: (
    installationId: number
  ) => Promise<{ token: string }>;
  installationFetch: <T>(token: string, url: string) => Promise<T>;
};

const defaultDeps: ListGithubOrgMembersDeps = {
  createInstallationAccessToken: createGithubInstallationAccessToken,
  installationFetch: githubInstallationFetch,
};

// Lists members of `orgLogin` via the installation token, then resolves each
// member's public profile email via /users/{login}. The org-members endpoint
// itself does not expose email, so the second step is what makes bulk-invite
// useful. Members without a public email remain { email: null } so the caller
// can surface a count.
//
// Token lifetime: GitHub App installation access tokens are valid for 1 hour.
// Current worst case at MAX_PAGES=10 / USER_LOOKUP_CONCURRENCY=20 is ~1010
// requests (~50 batches) which is well under that budget. If MAX_PAGES or the
// concurrency knob ever grows by an order of magnitude, refresh the token
// between pages or batches instead of acquiring it once up front.
export async function listGithubOrgMembersWithEmails(
  installationId: number,
  orgLogin: string,
  overrides: Partial<ListGithubOrgMembersDeps> = {}
): Promise<GithubOrgMember[]> {
  const deps: ListGithubOrgMembersDeps = { ...defaultDeps, ...overrides };
  const { token } = await deps.createInstallationAccessToken(installationId);
  const logins: string[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await deps.installationFetch<SimpleUser[]>(
      token,
      `https://api.github.com/orgs/${encodeURIComponent(orgLogin)}/members?per_page=${PAGE_SIZE}&page=${page}`
    );
    logins.push(...batch.map((u) => u.login));
    if (batch.length < PAGE_SIZE) break;
  }

  const members: GithubOrgMember[] = [];
  for (let i = 0; i < logins.length; i += USER_LOOKUP_CONCURRENCY) {
    const slice = logins.slice(i, i + USER_LOOKUP_CONCURRENCY);
    const resolved = await Promise.all(
      slice.map(async (login) => {
        try {
          const user = await deps.installationFetch<GithubUser>(
            token,
            `https://api.github.com/users/${encodeURIComponent(login)}`
          );
          return { login, email: user.email ?? null };
        } catch (err) {
          // Rate-limit responses must not be silently swallowed — otherwise a
          // 429 looks like "member has no public email" and the caller sees an
          // empty result set instead of a real failure. Re-throw to fail the
          // whole listing so the route returns a real error. This intentionally
          // discards already-resolved batches; the caller must treat the preview
          // as an all-or-nothing result.
          if (err instanceof GithubHttpError && err.status === 429) {
            throw err;
          }
          // A single 404/forbidden should not poison the whole batch — treat
          // as "no public email" so the caller still sees the count.
          return { login, email: null };
        }
      })
    );
    members.push(...resolved);
  }

  return members;
}
