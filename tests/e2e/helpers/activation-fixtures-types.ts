import type { GithubPrimaryAction, GithubState } from "@/lib/github-state";
import type { VercelCapability } from "@/lib/vercel/capabilities";

export type TrackedEvent = {
  name: string;
  properties?: Record<string, string | number | boolean | null | undefined>;
};

export type MockUser = {
  id: string;
  email: string;
  username: string;
  name: string;
  avatar_url: string;
  github_connected: boolean;
  github_app_connected: boolean;
  github_app_available: boolean;
  github_connection_mode: "oauth" | "app" | null;
  github_state?: GithubState;
  github_status_label?: string;
  github_status_detail?: string;
  github_primary_action?: GithubPrimaryAction;
  github_install_pending?: boolean;
  github_installation_count?: number;
  github_synced_repo_count?: number;
  vercel: VercelCapability;
};

export type MockRepo = {
  id: string;
  full_name: string;
  owner: string;
  name: string;
  default_branch: string;
  is_hidden: boolean;
  is_favorite: boolean;
  dev_port: number;
  sandbox_timeout_ms: number;
};

export type GithubSyncResponse =
  | { ok?: true; repos?: MockRepo[] }
  | { ok: false; status?: number; error: string };
