import manifestTemplate from "@/github-app-manifest.json";

/** The origin used in `github-app-manifest.json`, replaced with the real one. */
export const GITHUB_MANIFEST_PLACEHOLDER_ORIGIN = "https://mogplex.example.com";

/** GitHub limits App names to 34 characters. */
export const GITHUB_APP_NAME_MAX_LENGTH = 34;

const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export type GithubAppManifest = typeof manifestTemplate;

/**
 * Builds the GitHub App manifest for a deployment at `appOrigin`, from the
 * committed template, so manual and automated setups request the same
 * permissions and events.
 */
export function buildGithubAppManifest(
  appOrigin: string,
  name: string = manifestTemplate.name
): GithubAppManifest {
  const origin = new URL(appOrigin).origin;
  const manifest = JSON.parse(
    JSON.stringify(manifestTemplate).replaceAll(
      GITHUB_MANIFEST_PLACEHOLDER_ORIGIN,
      origin
    )
  ) as GithubAppManifest;
  return { ...manifest, name };
}

/** A default App name that is unlikely to collide on GitHub. */
export function defaultGithubAppName(appOrigin: string): string {
  const host = new URL(appOrigin).hostname;
  return `Mogplex ${host}`.slice(0, GITHUB_APP_NAME_MAX_LENGTH).trim();
}

export function validateGithubAppName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name for the GitHub App.";
  if (trimmed.length > GITHUB_APP_NAME_MAX_LENGTH) {
    return `GitHub App names can have at most ${GITHUB_APP_NAME_MAX_LENGTH} characters.`;
  }
  return null;
}

export function isValidGithubLogin(login: string): boolean {
  return GITHUB_LOGIN_PATTERN.test(login);
}

/**
 * Where the manifest form posts: the user's account, or an organization when
 * `organization` is set. Returns null for an invalid organization login.
 */
export function githubManifestFormAction(
  state: string,
  organization?: string
): string | null {
  const org = organization?.trim();
  if (org && !isValidGithubLogin(org)) return null;
  const path = org
    ? `/organizations/${encodeURIComponent(org)}/settings/apps/new`
    : "/settings/apps/new";
  const url = new URL(path, "https://github.com");
  url.searchParams.set("state", state);
  return url.toString();
}
