import { connectedUser, disconnectedGithubUser } from "./activation-fixtures";

export const installPendingUser = {
  ...disconnectedGithubUser,
  github_app_available: true,
  github_state: "app_install_pending" as const,
  github_status_label: "Install pending",
  github_status_detail:
    "Finish the GitHub App install in GitHub. Mogplex will pick up the installation and sync coverage.",
  github_primary_action: {
    kind: "complete_install" as const,
    label: "Complete GitHub App install",
    href: "/api/auth/github",
  },
  github_install_pending: true,
  github_installation_count: 0,
  github_synced_repo_count: 0,
};

export const oauthInstallPendingUser = {
  ...connectedUser,
  github_app_available: true,
  github_state: "app_install_pending" as const,
  github_status_label: "Install pending",
  github_status_detail:
    "Finish the GitHub App install in GitHub. Mogplex will pick up the installation and sync coverage.",
  github_primary_action: {
    kind: "complete_install" as const,
    label: "Complete GitHub App install",
    href: "/api/auth/github",
  },
  github_install_pending: true,
  github_installation_count: 0,
  github_synced_repo_count: 0,
};
