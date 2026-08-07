import type { Agent, Trigger, TriggerEvent } from "@/lib/types";

export type Installation = {
  id: string;
  installation_id: number;
  account_login: string | null;
  account_type: string | null;
  target_type: string | null;
  repository_count?: number;
  synced_repo_count?: number;
  scope_label?: string;
  manage_url?: string;
  repositories: Array<{
    id: string;
    full_name: string;
  }>;
};

export type AuthUserResponse = {
  user: {
    github_connected: boolean;
    github_app_available: boolean;
    github_installation_count?: number;
    github_synced_repo_count?: number;
    github_state?:
      | "disconnected"
      | "oauth_connected"
      | "app_install_pending"
      | "app_installed"
      | "app_installed_with_synced_repos";
    github_status_label?: string;
    github_status_detail?: string;
    github_primary_action?: {
      label: string;
      href: string;
    } | null;
    github_connection_mode: "app" | "oauth" | null;
    github_username: string | null;
  } | null;
};

export type RepoSummary = {
  id: string;
  full_name: string;
  github_installation_id?: number | null;
};

export type TriggerWithAgent = Trigger & {
  agents: Pick<Agent, "id" | "name" | "slug" | "model"> | null;
};

export const EVENT_OPTIONS: { value: TriggerEvent; label: string }[] = [
  { value: "mention", label: "@mogplex" },
  { value: "pr_opened", label: "PR opened" },
  { value: "issue_opened", label: "Issue opened" },
  { value: "pr_comment", label: "PR comment" },
  { value: "issue_comment", label: "Issue comment" },
  { value: "push", label: "Push" },
  { value: "ci_failure", label: "CI failure" },
];

export const EVENT_BADGES: Record<
  TriggerEvent,
  { label: string; color: string }
> = {
  mention: {
    label: "@mogplex",
    color: "text-purple-400 border-purple-400/20 bg-purple-400/[0.06]",
  },
  pr_opened: {
    label: "PR",
    color: "text-accent-blue border-accent-blue/20 bg-accent-blue/[0.06]",
  },
  issue_opened: {
    label: "Issue",
    color: "text-amber-400 border-amber-400/20 bg-amber-400/[0.06]",
  },
  pr_comment: {
    label: "PR comment",
    color: "text-accent-blue border-accent-blue/20 bg-accent-blue/[0.06]",
  },
  issue_comment: {
    label: "Issue comment",
    color: "text-amber-400 border-amber-400/20 bg-amber-400/[0.06]",
  },
  push: {
    label: "Push",
    color: "text-accent-green border-accent-green/20 bg-accent-green/[0.06]",
  },
  ci_failure: {
    label: "CI fail",
    color: "text-accent-red border-accent-red/20 bg-accent-red/[0.06]",
  },
  labeled: {
    label: "Label",
    color: "text-teal-400 border-teal-400/20 bg-teal-400/[0.06]",
  },
  tag_push: {
    label: "Tag",
    color: "text-sky-400 border-sky-400/20 bg-sky-400/[0.06]",
  },
  schedule: {
    label: "Schedule",
    color: "text-cyan-400 border-cyan-400/20 bg-cyan-400/[0.06]",
  },
  webhook: {
    label: "Webhook",
    color: "text-orange-400 border-orange-400/20 bg-orange-400/[0.06]",
  },
  slack_mention: {
    label: "Slack",
    color: "text-fuchsia-400 border-fuchsia-400/20 bg-fuchsia-400/[0.06]",
  },
};

export function getInstallationAccountScope(installation: Installation) {
  if (installation.scope_label) return installation.scope_label;
  const rawScope =
    installation.target_type || installation.account_type || "Account";
  if (rawScope.toLowerCase().includes("org")) return "Org";
  if (rawScope.toLowerCase().includes("user")) return "User";
  return rawScope;
}

export function getInstallationLabel(installation: Installation) {
  return (
    installation.account_login || `Installation ${installation.installation_id}`
  );
}

export function getInstallationRepoSummary(installation: Installation) {
  if (installation.repositories.length === 0) {
    return "No synced repos yet";
  }

  if (installation.repositories.length <= 3) {
    return installation.repositories.map((repo) => repo.full_name).join(", ");
  }

  return `${installation.repositories
    .slice(0, 2)
    .map((repo) => repo.full_name)
    .join(", ")} +${installation.repositories.length - 2} more`;
}

export const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API error: ${r.status}`);
  return r.json();
};
