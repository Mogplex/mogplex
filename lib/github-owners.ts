type GithubOrgPayload = {
  login?: string;
};

type GithubOrgCreationSettings = {
  members_can_create_repositories?: boolean;
  members_can_create_private_repositories?: boolean;
};

type GithubOrgMembership = {
  role?: "admin" | "member";
  state?: "active" | "pending";
};

export type GithubInstallationOwner = {
  installation_id: number;
  account_login: string | null;
  account_type: string | null;
  target_type: string | null;
};

export type GithubRepoOwnerTarget = {
  login: string;
  kind: "personal" | "org";
  github_installation_id: number | null;
  scope_label: string;
  source: "oauth" | "installation" | "oauth+installation";
};

function getInstallationScopeLabel(installation: {
  target_type: string | null;
  account_type: string | null;
}) {
  const rawScope =
    installation.target_type || installation.account_type || "Account";
  if (rawScope.toLowerCase().includes("org")) return "Org";
  if (rawScope.toLowerCase().includes("user")) return "User";
  return rawScope;
}

async function githubOAuthFetch<T>(token: string, url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub owner lookup failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchGithubCurrentUserContext(token: string) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `GitHub owner lookup failed (${response.status}): ${await response.text()}`
    );
  }
  const user = (await response.json()) as { login?: string };
  const scopesHeader = response.headers.get("x-oauth-scopes");
  return {
    login:
      typeof user.login === "string" && user.login.trim()
        ? user.login.trim()
        : null,
    oauthScopes:
      scopesHeader === null
        ? null
        : scopesHeader
            .split(",")
            .map((scope) => scope.trim())
            .filter(Boolean),
  };
}

export async function fetchGithubCurrentUserLogin(token: string) {
  return (await fetchGithubCurrentUserContext(token)).login;
}

export async function fetchGithubUserOrgs(token: string) {
  const orgs = await githubOAuthFetch<GithubOrgPayload[]>(
    token,
    "https://api.github.com/user/orgs?per_page=100"
  );
  return orgs
    .map((org) => (typeof org.login === "string" ? org.login.trim() : ""))
    .filter(Boolean);
}

export function canCreatePrivateGithubOrgRepo(
  settings: GithubOrgCreationSettings,
  membership: GithubOrgMembership
) {
  if (membership.state !== "active") return false;
  if (membership.role === "admin") return true;
  // GitHub can omit repository-creation policy fields when the token cannot
  // read org settings. Treat unknown as potentially allowed so valid private
  // memberships stay visible; the create API remains the enforcement point.
  if (settings.members_can_create_repositories === false) return false;
  return settings.members_can_create_private_repositories !== false;
}

export async function filterCreatableGithubOrgLogins(
  token: string,
  orgLogins: string[]
) {
  const results: Array<string | null> = [];
  const concurrency = 4;

  for (let index = 0; index < orgLogins.length; index += concurrency) {
    const batch = await Promise.all(
      orgLogins.slice(index, index + concurrency).map(async (login) => {
        try {
          const encodedLogin = encodeURIComponent(login);
          const [settings, membership] = await Promise.all([
            githubOAuthFetch<GithubOrgCreationSettings>(
              token,
              `https://api.github.com/orgs/${encodedLogin}`
            ),
            githubOAuthFetch<GithubOrgMembership>(
              token,
              `https://api.github.com/user/memberships/orgs/${encodedLogin}`
            ),
          ]);
          return canCreatePrivateGithubOrgRepo(settings, membership)
            ? login
            : null;
        } catch (error) {
          console.warn("[github-owners] repo creation permission unavailable", {
            login,
            error,
          });
          return null;
        }
      })
    );
    results.push(...batch);
  }

  return results.flatMap((login) => (login ? [login] : []));
}

export function buildGithubRepoOwnerTargets(input: {
  githubUsername: string | null;
  installations: GithubInstallationOwner[];
  orgLogins: string[];
}) {
  const targets = new Map<string, GithubRepoOwnerTarget>();
  const personalLogin = input.githubUsername?.trim() || null;

  if (personalLogin) {
    targets.set(personalLogin.toLowerCase(), {
      login: personalLogin,
      kind: "personal",
      github_installation_id: null,
      scope_label: "Personal",
      source: "oauth",
    });
  }

  for (const login of input.orgLogins) {
    const normalized = login.trim();
    if (!normalized) continue;
    targets.set(normalized.toLowerCase(), {
      login: normalized,
      kind:
        normalized.toLowerCase() === personalLogin?.toLowerCase()
          ? "personal"
          : "org",
      github_installation_id:
        targets.get(normalized.toLowerCase())?.github_installation_id ?? null,
      scope_label:
        normalized.toLowerCase() === personalLogin?.toLowerCase()
          ? "Personal"
          : "Org",
      source: targets.has(normalized.toLowerCase())
        ? "oauth+installation"
        : "oauth",
    });
  }

  for (const installation of input.installations) {
    const login = installation.account_login?.trim();
    if (!login) continue;

    const existing = targets.get(login.toLowerCase());
    const scopeLabel = getInstallationScopeLabel(installation);
    const kind =
      scopeLabel === "Org"
        ? "org"
        : login.toLowerCase() === personalLogin?.toLowerCase()
          ? "personal"
          : "org";

    targets.set(login.toLowerCase(), {
      login,
      kind,
      github_installation_id: installation.installation_id,
      scope_label: kind === "personal" ? "Personal" : scopeLabel,
      source: existing ? "oauth+installation" : "installation",
    });
  }

  return [...targets.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "personal" ? -1 : 1;
    return a.login.localeCompare(b.login);
  });
}
