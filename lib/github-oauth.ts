export const GITHUB_OAUTH_SCOPES = [
  "repo",
  "read:org",
  "read:user",
  "user:email",
] as const;

export const GITHUB_OAUTH_SCOPE = GITHUB_OAUTH_SCOPES.join(" ");
export const GITHUB_ORG_READ_SCOPE = "read:org";
export const GITHUB_REAUTHORIZE_HEADER = "x-mogplex-github-reauthorize";
