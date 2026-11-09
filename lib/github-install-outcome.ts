export type GithubInstallToast = {
  title: string;
  description: string;
  variant: "success" | "info" | "destructive";
};

const RETRY = "Start again from Settings, or reload the page in a minute.";

/** Every `reason` the GitHub callback can report with `?github=error`. */
export type GithubInstallFailureReason =
  | "github_installation_fetch"
  | "github_installation_invalid"
  | "github_installation_owner_required"
  | "github_installation_persist"
  | "github_installation_state"
  | "github_profile_update"
  | "github_repository_authorization"
  | "github_token_error"
  | "github_token_exchange"
  | "github_token_store"
  | "github_user_fetch"
  | "invalid_state";

const GENERIC_FAILURE: GithubInstallToast = {
  title: "GitHub connection failed",
  description: RETRY,
  variant: "destructive",
};

/** Messages for each failure reason; a new reason must pick one here. */
const FAILURES: Record<GithubInstallFailureReason, GithubInstallToast> = {
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
  github_installation_persist: GENERIC_FAILURE,
  github_profile_update: GENERIC_FAILURE,
  github_repository_authorization: GENERIC_FAILURE,
  github_token_error: GENERIC_FAILURE,
  github_token_exchange: GENERIC_FAILURE,
  github_token_store: GENERIC_FAILURE,
  github_user_fetch: GENERIC_FAILURE,
};

function isFailureReason(
  reason: string | null
): reason is GithubInstallFailureReason {
  return reason !== null && Object.hasOwn(FAILURES, reason);
}

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
  const reason = params.get("reason");
  return isFailureReason(reason) ? FAILURES[reason] : GENERIC_FAILURE;
}
