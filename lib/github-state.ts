export type GithubState =
  | "disconnected"
  | "oauth_connected"
  | "app_install_pending"
  | "app_installed"
  | "app_installed_with_synced_repos";

export type GithubPrimaryAction = {
  kind: "connect" | "install" | "complete_install" | "open_spaces";
  label: string;
  href: string;
} | null;

export type RepoGithubAccessState = "app_covered" | "synced_only";

export function deriveGithubState(input: {
  hasGithubToken: boolean;
  githubAppAvailable: boolean;
  installationCount: number;
  syncedRepoCount: number;
  coveredRepoCount?: number;
  installPending: boolean;
}) {
  const installationCount = Math.max(0, input.installationCount);
  const syncedRepoCount = Math.max(0, input.syncedRepoCount);
  const coveredRepoCount = Math.max(0, input.coveredRepoCount ?? 0);
  const githubAppConnected = installationCount > 0 || coveredRepoCount > 0;
  const githubConnected = input.hasGithubToken || githubAppConnected;
  const githubConnectionMode = githubAppConnected
    ? ("app" as const)
    : input.hasGithubToken
      ? ("oauth" as const)
      : null;

  let githubState: GithubState = "disconnected";
  if (githubAppConnected && coveredRepoCount > 0) {
    githubState = "app_installed_with_synced_repos";
  } else if (githubAppConnected) {
    githubState = "app_installed";
  } else if (input.githubAppAvailable && input.installPending) {
    githubState = "app_install_pending";
  } else if (input.hasGithubToken) {
    githubState = "oauth_connected";
  }

  let githubStatusLabel = "Not connected";
  let githubStatusDetail =
    "Install the GitHub App to sync repositories and enable triggers.";
  let githubPrimaryAction: GithubPrimaryAction = input.githubAppAvailable
    ? { kind: "install", label: "Install GitHub App", href: "/api/auth/github" }
    : { kind: "connect", label: "Connect GitHub", href: "/api/auth/github" };

  switch (githubState) {
    case "oauth_connected":
      githubStatusLabel = "OAuth only";
      githubStatusDetail = input.githubAppAvailable
        ? "Repositories can sync through OAuth, but triggers and automation require the GitHub App."
        : "GitHub is connected through OAuth.";
      githubPrimaryAction = input.githubAppAvailable
        ? {
            kind: "install",
            label: "Install GitHub App",
            href: "/api/auth/github",
          }
        : null;
      break;
    case "app_install_pending":
      githubStatusLabel = "Install pending";
      githubStatusDetail =
        "Finish the GitHub App install in GitHub. Mogplex will pick up the installation and sync coverage.";
      githubPrimaryAction = {
        kind: "complete_install",
        label: "Complete GitHub App install",
        href: "/api/auth/github",
      };
      break;
    case "app_installed":
      githubStatusLabel = "App installed";
      githubStatusDetail =
        "The GitHub App is installed, but no covered repositories are synced into Projects yet.";
      githubPrimaryAction = {
        kind: "open_spaces",
        label: "Open Projects",
        href: "/projects/repositories",
      };
      break;
    case "app_installed_with_synced_repos":
      githubStatusLabel = "Ready";
      githubStatusDetail =
        "GitHub App coverage is active and synced repositories are available in Projects.";
      githubPrimaryAction = null;
      break;
    case "disconnected":
    default:
      break;
  }

  return {
    github_state: githubState,
    github_connected: githubConnected,
    github_app_connected: githubAppConnected,
    github_connection_mode: githubConnectionMode,
    github_app_available: input.githubAppAvailable,
    github_install_pending:
      input.githubAppAvailable && input.installPending && !githubAppConnected,
    github_installation_count: installationCount,
    github_synced_repo_count: syncedRepoCount,
    github_covered_repo_count: coveredRepoCount,
    github_status_label: githubStatusLabel,
    github_status_detail: githubStatusDetail,
    github_primary_action: githubPrimaryAction,
  };
}

export function deriveRepoGithubCoverage(input: {
  hasInstallations: boolean;
  githubInstallationId?: number | null;
}) {
  const githubAppCovered = Boolean(input.githubInstallationId);
  const githubAccessState: RepoGithubAccessState = githubAppCovered
    ? "app_covered"
    : "synced_only";

  let githubCoverageLabel = "Synced only";
  let githubCoverageDetail =
    "This repo is visible in Projects, but it is not covered by a GitHub App installation yet.";

  if (githubAppCovered) {
    githubCoverageLabel = "Trigger-ready";
    githubCoverageDetail =
      "This repo is covered by a GitHub App installation and can be used for triggers.";
  } else if (input.hasInstallations) {
    githubCoverageLabel = "Not covered";
    githubCoverageDetail =
      "The GitHub App is installed elsewhere, but this repo is not covered by the current installation scope.";
  }

  return {
    github_has_app_installation: input.hasInstallations,
    github_app_covered: githubAppCovered,
    github_triggerable: githubAppCovered,
    github_access_state: githubAccessState,
    github_coverage_label: githubCoverageLabel,
    github_coverage_detail: githubCoverageDetail,
  };
}
