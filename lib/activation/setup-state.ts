import type { GithubPrimaryAction, GithubState } from "@/lib/github-state";
import type { VercelCapability } from "@/lib/vercel/capabilities";

export type ActivationSetupUser = {
  github_connected?: boolean | null;
  github_app_available?: boolean | null;
  github_state?: GithubState | null;
  github_status_label?: string | null;
  github_status_detail?: string | null;
  github_primary_action?: GithubPrimaryAction | null;
  vercel?: VercelCapability | null;
  platform_access?: {
    allowPlatformAi?: boolean | null;
    allowPlatformSandbox?: boolean | null;
  } | null;
};

export type VercelSetupState =
  | "disconnected"
  | "oauth_connected_needs_project"
  | "linked"
  | "platform_billed";

export type VercelPrimaryAction = {
  kind: "connect" | "link_project";
  label: string;
  href: string;
} | null;

export type VercelSetupPresentation = {
  state: VercelSetupState;
  label: string;
  detail: string;
  primaryAction: VercelPrimaryAction;
  canLaunchSandbox: boolean;
};

export type GithubSetupPresentation = {
  state: GithubState;
  connectLabel: string;
  label: string;
  detail: string;
  primaryAction: GithubPrimaryAction;
  isConnectionReady: boolean;
  canSyncRepos: boolean;
};

export function presentGithubSetup(
  user: ActivationSetupUser | null | undefined
): GithubSetupPresentation {
  const connectLabel = user?.github_app_available
    ? "Install GitHub App"
    : "Connect GitHub";
  const state =
    user?.github_state ??
    (user?.github_connected ? "oauth_connected" : "disconnected");
  const hasGithubConnection = Boolean(user?.github_connected);

  const fallbackDetail =
    state === "app_install_pending"
      ? "Finish the GitHub App install in GitHub before importing repositories."
      : state === "oauth_connected"
        ? "GitHub is connected. Repositories can sync now, and the GitHub App can be installed later for trigger coverage."
        : state === "app_installed"
          ? "The GitHub App is installed, but no synced repositories are available yet."
          : state === "app_installed_with_synced_repos"
            ? "GitHub App coverage is active and synced repositories are ready."
            : "Connect GitHub to import repositories and launch workspaces.";

  const primaryAction =
    user?.github_primary_action ??
    (state === "app_install_pending"
      ? {
          kind: "complete_install",
          label: "Complete GitHub App install",
          href: "/api/auth/github",
        }
      : state === "disconnected"
        ? {
            kind: user?.github_app_available ? "install" : "connect",
            label: connectLabel,
            href: "/api/auth/github",
          }
        : state === "oauth_connected" && user?.github_app_available
          ? {
              kind: "install",
              label: "Install GitHub App",
              href: "/api/auth/github",
            }
          : null);

  return {
    state,
    connectLabel,
    label:
      user?.github_status_label ||
      (state === "oauth_connected" ? "GitHub connected" : connectLabel),
    detail: user?.github_status_detail || fallbackDetail,
    primaryAction,
    isConnectionReady:
      state !== "disconnected" && state !== "app_install_pending",
    canSyncRepos:
      state !== "disconnected" &&
      (state !== "app_install_pending" || hasGithubConnection),
  };
}

export function presentProjectsEmptyState(setup: GithubSetupPresentation) {
  switch (setup.state) {
    case "app_install_pending":
      if (setup.canSyncRepos) {
        return {
          title:
            "GitHub is connected. Import repos now, then finish the GitHub App install for trigger coverage.",
          detail:
            "You can bring repos into your default project right away. Finish the install later to enable GitHub App-backed triggers and automation.",
        };
      }
      return {
        title: "Finish the GitHub App install, then create your first project.",
        detail:
          "Once the installation completes, Mogplex can import repos into your default project or create new repos in app.",
      };
    case "oauth_connected":
      return {
        title:
          "GitHub is connected. Create a project, then decide whether to import or create repos.",
        detail:
          "Projects can be empty. Create one now, then add repos when you are ready.",
      };
    case "app_installed":
    case "app_installed_with_synced_repos":
      return {
        title: "Create your first project.",
        detail:
          "Projects organize your repos. You can create one empty or import GitHub repos into the default imported project.",
      };
    case "disconnected":
    default:
      return {
        title: `${setup.connectLabel} or create your first project.`,
        detail: `${setup.connectLabel}, then create a project and add repos.`,
      };
  }
}

export function presentRepoSyncFailure(
  errorCode: string | null | undefined,
  connectLabel: string
) {
  if (errorCode === "NO_GITHUB_CONNECTION") {
    return `${connectLabel} to sync repos.`;
  }
  return "GitHub repo sync failed. Retry sync.";
}

export function presentVercelSetup(
  user: ActivationSetupUser | null | undefined
): VercelSetupPresentation {
  const allowPlatformSandbox = Boolean(
    user?.platform_access?.allowPlatformSandbox
  );
  const vercel = user?.vercel ?? null;

  if (allowPlatformSandbox) {
    return {
      state: "platform_billed",
      label: "Platform sandbox enabled",
      detail:
        "Sandboxes for this account are billed to Mogplex. No Vercel connection needed.",
      primaryAction: null,
      canLaunchSandbox: true,
    };
  }

  if (vercel?.canUseUserBilling) {
    return {
      state: "linked",
      label: "Vercel connected",
      detail:
        vercel.statusDetail ||
        "Vercel is linked and a billing project is selected. Sandboxes will bill to your Vercel project.",
      primaryAction: null,
      canLaunchSandbox: true,
    };
  }

  if (vercel?.canLinkUserBillingProject) {
    return {
      state: "oauth_connected_needs_project",
      label: "Select a Vercel billing project",
      detail:
        "Vercel is connected. Create a project to pick which Vercel project sandbox runs should bill to.",
      // href here is a fallback — the dashboard component swaps in an onClick
      // that opens the New project dialog (which includes the Vercel project
      // selector). Keep the href pointing to /api/auth/vercel so a direct
      // navigation still lands somewhere useful instead of a dead page.
      primaryAction: {
        kind: "link_project",
        label: "Create project with Vercel billing",
        href: "/api/auth/vercel",
      },
      canLaunchSandbox: false,
    };
  }

  return {
    state: "disconnected",
    label: "Connect Vercel",
    detail:
      "Sandboxes run on Vercel's infrastructure and bill to your Vercel project. Connect your account to launch sandboxes.",
    primaryAction: {
      kind: "connect",
      label: "Connect Vercel",
      href: "/api/auth/vercel",
    },
    canLaunchSandbox: false,
  };
}

export function presentSandboxEmptyState(vercel: VercelSetupPresentation) {
  switch (vercel.state) {
    case "platform_billed":
    case "linked":
      return {
        title: "Ready to launch sandboxes",
        detail:
          "Open a repo and click launch to start a sandbox for a live preview.",
      };
    case "oauth_connected_needs_project":
      return {
        title: "Select a Vercel project to bill sandboxes to",
        detail:
          "Vercel is connected — finish setup by selecting a billing project in your workspace or repo settings.",
      };
    case "disconnected":
    default:
      return {
        title: "Connect Vercel to launch sandboxes",
        detail:
          "Sandboxes run on Vercel's infrastructure and bill to your Vercel project. Connecting takes less than a minute.",
      };
  }
}
