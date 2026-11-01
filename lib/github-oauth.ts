export const GITHUB_IDENTITY_OAUTH_SCOPES = [
  "read:org",
  "read:user",
  "user:email",
] as const;
export const GITHUB_OAUTH_SCOPES = [
  "repo",
  ...GITHUB_IDENTITY_OAUTH_SCOPES,
] as const;

export const GITHUB_OAUTH_SCOPE = GITHUB_OAUTH_SCOPES.join(" ");
export function getGithubOAuthGrantConfiguration(identityOnlyGrant: boolean) {
  return {
    scope: identityOnlyGrant
      ? GITHUB_IDENTITY_OAUTH_SCOPES.join(" ")
      : GITHUB_OAUTH_SCOPE,
    repositoryAuthMode: identityOnlyGrant
      ? ("app" as const)
      : ("oauth" as const),
  };
}
export const GITHUB_ORG_READ_SCOPE = "read:org";
export const GITHUB_REAUTHORIZE_HEADER = "x-mogplex-github-reauthorize";

/**
 * Carries the in-app path to return to across the GitHub round trip. GitHub
 * owns the redirect back, so the callback cannot read it from the query string.
 */
export const GITHUB_RETURN_TO_COOKIE = "github_return_to";
export const GITHUB_INSTALL_STATE_COOKIE = "github_app_install_state";
