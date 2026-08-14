export const GITHUB_OAUTH_SCOPES = [
  "repo",
  "read:org",
  "read:user",
  "user:email",
] as const;

export const GITHUB_OAUTH_SCOPE = GITHUB_OAUTH_SCOPES.join(" ");
