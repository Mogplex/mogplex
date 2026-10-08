/** Headers for a GitHub REST or GraphQL request made with an installation token. */
export function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
}
