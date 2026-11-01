import {
  fetchGithubCurrentUserContext,
  type GithubRepoOwnerTarget,
} from "@/lib/github-owners";
import { loadUserGithubInstallations } from "@/app/api/github/_lib/user-installations";

/**
 * The single owner an App-deployment create names, without listing every org.
 * The credential resolver checks ownership live for that org, so a GitHub
 * failure here propagates instead of reading as a permission denial.
 */
export async function loadGithubAppCreateTarget(
  userId: string,
  token: string,
  login: string
): Promise<{
  target: GithubRepoOwnerTarget | null;
  oauthScopes: string[] | null;
}> {
  const [currentUser, installations] = await Promise.all([
    fetchGithubCurrentUserContext(token),
    // Only installations this user connected count, never one another org
    // admin installed: gaining access to an org must not let Mogplex act on
    // it without this user's own consent (#694). Such an owner sees the
    // install step and connects the existing installation once.
    loadUserGithubInstallations(userId),
  ]);
  if (installations.error) {
    throw new Error(
      `Failed to load GitHub installations: ${installations.error.message}`
    );
  }
  // Without the signed-in login a personal account would read as an org and
  // be refused as not owned; treat it as a GitHub failure to retry instead.
  if (!currentUser.login)
    throw new Error("GitHub did not return the signed-in login");
  const personal = currentUser.login.toLowerCase() === login.toLowerCase();
  const installation = (installations.data ?? []).find(
    (row) =>
      typeof row.account_login === "string" &&
      row.account_login.toLowerCase() === login.toLowerCase()
  );
  const installationId = Number(installation?.installation_id);
  return {
    target: {
      login,
      kind: personal ? "personal" : "org",
      github_installation_id:
        Number.isSafeInteger(installationId) && installationId > 0
          ? installationId
          : null,
      scope_label: personal ? "Personal" : "Org",
      source: installation ? "installation" : "oauth",
    },
    oauthScopes: currentUser.oauthScopes,
  };
}
