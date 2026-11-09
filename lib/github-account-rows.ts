/**
 * One row per GitHub account on Settings → Account, merging the accounts a
 * user can connect (`/api/github/owners`) with the installations already
 * connected to them (`/api/github/installations`).
 */

type InstallationInput = {
  id: string;
  installation_id: number;
  account_login: string | null;
  scope_label: string;
  synced_repo_count: number;
  manage_url: string | null;
  repositories: Array<{ id: string; full_name: string }>;
};

type OwnerInput = {
  login: string;
  kind: "personal" | "org";
};

export type GithubAccountKind = "Personal account" | "Organization" | "Account";

export type GithubAccountRow = {
  key: string;
  login: string;
  kind: GithubAccountKind;
  /** Present when the Mogplex app is installed and linked to this user. */
  connection: {
    syncedRepoCount: number;
    repoPreview: string[];
    moreRepoCount: number;
    manageUrl: string | null;
  } | null;
};

const REPO_PREVIEW_COUNT = 3;

function kindFromScopeLabel(scopeLabel: string): GithubAccountKind {
  if (scopeLabel === "Org") return "Organization";
  if (scopeLabel === "User" || scopeLabel === "Personal")
    return "Personal account";
  return "Account";
}

/**
 * Connected accounts first, then the accounts the user could still connect,
 * each alphabetical. An account that appears in both lists shows once.
 */
export function buildGithubAccountRows(
  installations: InstallationInput[],
  owners: OwnerInput[]
): GithubAccountRow[] {
  const connected: GithubAccountRow[] = [];
  const connectedLogins = new Set<string>();

  for (const installation of installations) {
    const login =
      installation.account_login ||
      `Installation ${installation.installation_id}`;
    connectedLogins.add(login.toLowerCase());
    connected.push({
      key: `installation-${installation.id}`,
      login,
      kind: kindFromScopeLabel(installation.scope_label),
      connection: {
        syncedRepoCount: installation.synced_repo_count,
        repoPreview: installation.repositories
          .slice(0, REPO_PREVIEW_COUNT)
          .map((repo) => repo.full_name),
        moreRepoCount: Math.max(
          0,
          installation.repositories.length - REPO_PREVIEW_COUNT
        ),
        manageUrl: installation.manage_url,
      },
    });
  }

  const unconnected: GithubAccountRow[] = [];
  for (const owner of owners) {
    if (connectedLogins.has(owner.login.toLowerCase())) continue;
    unconnected.push({
      key: `owner-${owner.kind}-${owner.login}`,
      login: owner.login,
      kind: owner.kind === "personal" ? "Personal account" : "Organization",
      connection: null,
    });
  }

  const byLogin = (a: GithubAccountRow, b: GithubAccountRow) =>
    a.login.localeCompare(b.login);
  return [...connected.sort(byLogin), ...unconnected.sort(byLogin)];
}
