export type GithubInstallToast = {
  title: string;
  description: string;
  variant: "success" | "info" | "destructive";
};

const RETRY = "Start again from Settings, or reload the page in a minute.";

/** Messages for the `reason` the GitHub callback reports with `?github=error`. */
const FAILURES: Record<string, GithubInstallToast> = {
  github_installation_owner_required: {
    title: "Only an owner can connect this account",
    description:
      "Connecting a GitHub organization takes an organization owner. Ask an owner to connect it in Mogplex, or use repositories shared with your Mogplex team.",
    variant: "destructive",
  },
  github_installation_state: {
    title: "GitHub connection expired",
    description:
      "The security check did not match this browser. Start the connection again from Settings.",
    variant: "destructive",
  },
  invalid_state: {
    title: "GitHub sign-in expired",
    description:
      "The security check did not match this browser. Start the connection again from Settings.",
    variant: "destructive",
  },
  github_installation_invalid: {
    title: "GitHub sent an unknown installation",
    description: RETRY,
    variant: "destructive",
  },
  github_installation_fetch: {
    title: "GitHub did not confirm the installation",
    description: RETRY,
    variant: "destructive",
  },
};

const GENERIC_FAILURE: GithubInstallToast = {
  title: "GitHub connection failed",
  description: RETRY,
  variant: "destructive",
};

/**
 * The toast for a GitHub callback outcome (`?github=connected`,
 * `?github=error&reason=…`), or null when the URL carries none.
 */
export function getGithubInstallToast(
  params: Pick<URLSearchParams, "get">
): GithubInstallToast | null {
  const status = params.get("github");
  if (status === "connected") {
    return params.get("repo_sync") === "failed"
      ? {
          title: "GitHub connected",
          description:
            "Repositories are still syncing. Reload the page in a minute to see them.",
          variant: "info",
        }
      : {
          title: "GitHub connected",
          description:
            "Mogplex can use the repositories you gave the Mogplex app access to.",
          variant: "success",
        };
  }
  if (status !== "error") return null;
  return FAILURES[params.get("reason") ?? ""] ?? GENERIC_FAILURE;
}
