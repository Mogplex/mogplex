import type { VercelCapability } from "@/lib/vercel/capabilities";
import type { MockUser, MockRepo } from "./activation-fixtures-types";

export const modelId = "minimax/minimax-m2.5";

export const linkedVercelCapability: VercelCapability = {
  platformState: "ready",
  personalState: "linked",
  linkedProjectState: "none",
  canUsePlatformOps: true,
  canLinkUserBillingProject: true,
  canUseUserBilling: false,
  statusLabel: "Platform ready",
  statusDetail:
    "Mogplex platform Vercel is ready. Personal Vercel is linked, but no billing project is selected yet.",
};

export const connectedUser: MockUser = {
  id: "user-1",
  email: "alex@example.com",
  username: "alex",
  name: "Alex",
  avatar_url: "https://example.com/avatar.png",
  github_connected: true,
  github_app_connected: false,
  github_app_available: false,
  github_connection_mode: "oauth",
  github_state: "oauth_connected",
  github_status_label: "GitHub connected",
  github_status_detail:
    "GitHub is connected. Spaces can sync now, and the GitHub App can be installed later for trigger coverage.",
  github_primary_action: null,
  github_install_pending: false,
  github_installation_count: 0,
  github_synced_repo_count: 0,
  vercel: linkedVercelCapability,
};

export const disconnectedGithubUser: MockUser = {
  ...connectedUser,
  github_connected: false,
  github_connection_mode: null,
  github_state: "disconnected",
  github_status_label: "Connect GitHub",
  github_status_detail:
    "Connect GitHub to import spaces and launch workspaces.",
  github_primary_action: {
    kind: "connect",
    label: "Connect GitHub",
    href: "/api/auth/github",
  },
};

export const syncedRepo: MockRepo = {
  id: "repo-1",
  full_name: "acme/demo-app",
  owner: "acme",
  name: "demo-app",
  default_branch: "main",
  is_hidden: false,
  is_favorite: false,
  dev_port: 3000,
  sandbox_timeout_ms: 600000,
};

export const secondaryRepo: MockRepo = {
  ...syncedRepo,
  id: "repo-2",
  full_name: "acme/docs-app",
  name: "docs-app",
};

// Matches AutomationFailuresResponse for specs that visit /observability but
// don't exercise the Automation Failures section.
export const emptyAutomationFailuresResponse = {
  records: [],
  total: 0,
  page: 1,
  limit: 25,
  summary: {
    failedTotal: 0,
    successfulRecoveries: 0,
    retriedFailures: 0,
    timeoutFailures: 0,
    authenticationFailures: 0,
    configurationFailures: 0,
    providerFailures: 0,
    dependencyFailures: 0,
  },
  breakdowns: {
    byFailureClass: [],
    bySourceType: [],
    byProvider: [],
    byModel: [],
    byTimeoutBucket: [],
  },
  filter_options: {
    failureClasses: [],
    sourceTypes: [],
    providers: [],
    models: [],
  },
};
