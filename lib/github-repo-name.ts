const GITHUB_REPO_NAME_MAX_LENGTH = 100;
const UNSUPPORTED_REPO_NAME_CHARACTERS = /[^A-Za-z0-9._-]+/g;

export function normalizeGithubRepoName(value: string): string {
  return value
    .trim()
    .replace(UNSUPPORTED_REPO_NAME_CHARACTERS, "-")
    .replace(/^-+|-+$/g, "");
}

export type GithubRepoNameValidation =
  | { ok: true; name: string; normalized: boolean }
  | { ok: false; message: string };

export function validateGithubRepoName(
  value: unknown
): GithubRepoNameValidation {
  if (typeof value !== "string") {
    return {
      ok: false,
      message: "Use letters, numbers, periods, hyphens, or underscores.",
    };
  }

  const name = normalizeGithubRepoName(value);
  if (!name) {
    return {
      ok: false,
      message: "Use letters, numbers, periods, hyphens, or underscores.",
    };
  }
  if (/^\.+$/.test(name) || name.endsWith(".")) {
    return {
      ok: false,
      message: "Repository names cannot contain only or end with periods.",
    };
  }
  if (name.length > GITHUB_REPO_NAME_MAX_LENGTH) {
    return {
      ok: false,
      message: "Repository names must be 100 characters or fewer.",
    };
  }

  return {
    ok: true,
    name,
    normalized: name !== value,
  };
}
