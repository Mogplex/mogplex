"use client";

import type { Repo, Agent, SandboxRecord, Workspace } from "@/lib/types";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { toast } from "@/hooks/use-toast";
import { useSessionsStore } from "@/hooks/use-sessions";
import {
  bindSessionToPendingSandboxBranch,
  ensureSessionSandboxBinding,
} from "@/lib/sandbox/session-retarget";
import type { useSandboxLaunchActions } from "@/components/sandbox-launch-provider";
import { sortRepos, getRepoOwner } from "./helpers";

export interface RepoActionsContext {
  activeTeamId: string | null;
  agents: Agent[];
  fetchData: () => Promise<void>;
  getSandboxForRepo: (repoId: string) => SandboxRecord | null | undefined;
  launchRepoSandbox: ReturnType<
    typeof useSandboxLaunchActions
  >["launchRepoSandbox"];
  launchSandbox: ReturnType<typeof useSandboxStore.getState>["launch"];
  onReposLoaded?: (repos: Repo[], agents: Agent[]) => void;
  repos: Repo[];
  setRepos: React.Dispatch<React.SetStateAction<Repo[]>>;
  stopSandbox: ReturnType<typeof useSandboxStore.getState>["stop"];
}

export function createToggleFavorite(ctx: RepoActionsContext) {
  return async (repo: Repo) => {
    const res = await fetch("/api/repos", {
      method: "PATCH",
      headers: getActiveTeamRequestHeaders(
        { "Content-Type": "application/json" },
        ctx.activeTeamId
      ),
      body: JSON.stringify({ id: repo.id, is_favorite: !repo.is_favorite }),
    });
    const data = await res.json();
    if (res.ok) {
      ctx.setRepos((current) => {
        const updated = sortRepos(
          current.map((item) => (item.id === data.id ? data : item))
        );
        ctx.onReposLoaded?.(updated, ctx.agents);
        return updated;
      });
    }
  };
}

export function createHideRepo(ctx: RepoActionsContext) {
  return async (repo: Repo) => {
    const res = await fetch("/api/repos", {
      method: "PATCH",
      headers: getActiveTeamRequestHeaders(
        { "Content-Type": "application/json" },
        ctx.activeTeamId
      ),
      body: JSON.stringify({ id: repo.id, is_hidden: !repo.is_hidden }),
    });
    if (res.ok) {
      toast({
        title: repo.is_hidden ? "Repository restored" : "Repository removed",
        description: repo.full_name,
      });
      void ctx.fetchData();
    }
  };
}

export function createHideByOwner(ctx: RepoActionsContext) {
  return async (owner: string) => {
    const ownerRepos = ctx.repos.filter(
      (repo) => getRepoOwner(repo) === owner && !repo.is_hidden
    );
    if (ownerRepos.length === 0) return;
    await Promise.all(
      ownerRepos.map((repo) =>
        fetch("/api/repos", {
          method: "PATCH",
          headers: getActiveTeamRequestHeaders(
            { "Content-Type": "application/json" },
            ctx.activeTeamId
          ),
          body: JSON.stringify({ id: repo.id, is_hidden: true }),
        })
      )
    );
    toast({
      title: `Removed ${ownerRepos.length} repositories`,
      description: owner,
    });
    void ctx.fetchData();
  };
}

export function createSaveRepoSettings(ctx: RepoActionsContext) {
  return async (repo: Repo) => {
    const res = await fetch("/api/repos", {
      method: "PATCH",
      headers: getActiveTeamRequestHeaders(
        { "Content-Type": "application/json" },
        ctx.activeTeamId
      ),
      body: JSON.stringify({
        id: repo.id,
        default_branch: repo.default_branch,
        vercel_team_id: repo.vercel_team_id,
        vercel_project_id: repo.vercel_project_id,
        sandbox_billing_target: repo.sandbox_billing_target,
        sandbox_billing_mode_override: repo.sandbox_billing_mode_override,
        env_sync_mode: repo.env_sync_mode,
        root_directory: repo.root_directory,
        install_command: repo.install_command,
        dev_command: repo.dev_command,
        dev_port: repo.dev_port,
        dev_port_auto: repo.dev_port_auto,
        sandbox_timeout_ms: repo.sandbox_timeout_ms,
        sandbox_env_vars: repo.sandbox_env_vars,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save repo settings");
    ctx.setRepos((current) =>
      sortRepos(current.map((item) => (item.id === data.id ? data : item)))
    );
    toast({ title: "Settings saved", description: repo.full_name });
  };
}

export function createRestartRepoSandbox(
  ctx: RepoActionsContext,
  saveRepoSettings: (repo: Repo) => Promise<void>
) {
  return async (repo: Repo) => {
    await saveRepoSettings(repo);
    const previousSandbox = ctx.getSandboxForRepo(repo.id);
    if (previousSandbox) await ctx.stopSandbox(previousSandbox.id);
    bindSessionToPendingSandboxBranch(
      useSessionsStore.getState().activeSessionId,
      previousSandbox?.working_branch ?? null
    );

    let launched: SandboxRecord | null | undefined;
    if (previousSandbox) {
      launched = await ctx.launchSandbox(repo.id, {
        repoId: repo.id,
        baseBranch: previousSandbox.base_branch,
        workingBranch: previousSandbox.working_branch,
        createBranch: false,
      });
    } else {
      await ctx.launchRepoSandbox(repo, {
        source: "repo_dashboard",
        trigger: "settings_restart",
        intent: { kind: "start_fresh", interactive: false },
      });
      launched = useSandboxStore.getState().getSandboxForRepo(repo.id);
    }

    if (launched?.id) {
      ensureSessionSandboxBinding(
        useSessionsStore.getState().activeSessionId,
        previousSandbox?.id ?? null,
        launched.id
      );
    }
  };
}

export function createHandleLaunchSandbox(ctx: RepoActionsContext) {
  return async (repo: Repo, trigger = "start_preview_button") => {
    try {
      const previousSandbox = ctx.getSandboxForRepo(repo.id);
      const outcome = await ctx.launchRepoSandbox(repo, {
        source: "repo_dashboard",
        trigger,
        intent: { kind: "start_fresh" },
      });
      if (outcome.status === "launched") {
        toast({ title: "Sandbox launching" });
        const launched = useSandboxStore.getState().getSandboxForRepo(repo.id);
        if (launched?.id) {
          ensureSessionSandboxBinding(
            useSessionsStore.getState().activeSessionId,
            previousSandbox?.id ?? null,
            launched.id
          );
        }
      }
    } catch (error) {
      toast({
        title: "Sandbox failed",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };
}

export function createHandleStopSandbox(ctx: RepoActionsContext) {
  return async (repoId: string) => {
    const sandbox = ctx.getSandboxForRepo(repoId);
    if (!sandbox) return;
    try {
      await ctx.stopSandbox(sandbox.id);
      toast({ title: "Sandbox stopped" });
    } catch (error) {
      toast({
        title: "Stop failed",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };
}

export function createHandleDeleteWorkspace(ctx: RepoActionsContext) {
  return async (workspace: Workspace) => {
    try {
      const response = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "DELETE",
        headers: getActiveTeamRequestHeaders(undefined, ctx.activeTeamId),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete project");
      }
      toast({ title: "Project deleted", description: workspace.name });
      await ctx.fetchData();
    } catch (error) {
      toast({
        title: "Delete failed",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };
}
