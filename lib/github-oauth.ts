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
/** Where a user authorizes the GitHub App; clients append `?next=`. */
export const GITHUB_APP_USER_AUTHORIZE_PATH = "/api/auth/github/app-user";
/** Set by /api/github/owners when this deployment cannot create personal repos. */
export const GITHUB_PERSONAL_UNAVAILABLE_HEADER =
  "x-mogplex-github-personal-unavailable";
/** Query param the App user authorization callback reports its outcome in. */
export const GITHUB_APP_USER_OUTCOME_PARAM = "github_app_user";

/**
 * Carries the in-app path to return to across the GitHub round trip. GitHub
 * owns the redirect back, so the callback cannot read it from the query string.
 */
export const GITHUB_RETURN_TO_COOKIE = "github_return_to";
export const GITHUB_INSTALL_STATE_COOKIE = "github_app_install_state";
