"use client";
import useSWR from "swr";
import { fetchJsonObject } from "@/lib/client-fetch";
import type { GithubPrimaryAction, GithubState } from "@/lib/github-state";
import type { VercelCapability } from "@/lib/vercel/capabilities";

type User = {
  id: string;
  email: string;
  username: string;
  name: string;
  avatar_url: string;
  github_username?: string | null;
  github_connected?: boolean;
  github_app_connected?: boolean;
  github_app_available?: boolean;
  github_install_pending?: boolean;
  github_installation_count?: number;
  github_synced_repo_count?: number;
  github_covered_repo_count?: number;
  github_state?: GithubState;
  github_status_label?: string;
  github_status_detail?: string;
  github_primary_action?: GithubPrimaryAction;
  github_connection_mode?: "oauth" | "app" | null;
  platform_access: {
    allowPlatformAi: boolean;
    allowPlatformSandbox: boolean;
  };
  vercel: VercelCapability;
  account_vercel_project_id?: string | null;
  account_vercel_team_id?: string | null;
} | null;

const fetcher = (url: string) =>
  fetchJsonObject<{ user: User }>(url, "Failed to load user");

export function useUser() {
  const { data, error, isLoading, mutate } = useSWR<{ user: User }>(
    "/api/auth/user",
    fetcher
  );

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    mutate({ user: null });
    window.location.href = "/login";
  };

  return {
    user: data?.user || null,
    isLoading,
    error,
    logout,
    mutate,
  };
}
