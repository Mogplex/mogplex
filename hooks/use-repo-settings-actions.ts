"use client";

import { useCallback } from "react";
import type { KeyedMutator } from "swr";
import type { Repo, SandboxRecord } from "@/lib/types";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { useSessionsStore } from "@/hooks/use-sessions";
import { toast } from "@/hooks/use-toast";
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";
import { useSandboxLaunchActions } from "@/components/sandbox-launch-provider";
import {
  bindSessionToPendingSandboxBranch,
  ensureSessionSandboxBinding,
} from "@/lib/sandbox/session-retarget";

/**
 * Save and restart actions for a project's settings drawer. Saving patches
 * the repo and writes the result into the shared repos cache; restarting
 * saves first, then replaces the repo's sandbox on the same branch.
 */
export function useRepoSettingsActions(mutateRepos: KeyedMutator<Repo[]>) {
  const activeTeamId = useActiveTeamId();
  const getSandboxForRepo = useSandboxStore((state) => state.getSandboxForRepo);
  const launchSandbox = useSandboxStore((state) => state.launch);
  const stopSandbox = useSandboxStore((state) => state.stop);
  const { launchRepoSandbox } = useSandboxLaunchActions();

  const saveRepo = useCallback(
    async (repo: Repo) => {
      const res = await fetch("/api/repos", {
        method: "PATCH",
        headers: getActiveTeamRequestHeaders(
          { "Content-Type": "application/json" },
          activeTeamId
        ),
        body: JSON.stringify({
          id: repo.id,
          runtime: repo.runtime,
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
      // A gateway error page is not JSON; fall back to a save message.
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(
          typeof data?.error === "string" && data.error
            ? data.error
            : "Failed to save project settings"
        );
      }
      await mutateRepos(
        (current) =>
          (current ?? []).map((item) => (item.id === data.id ? data : item)),
        { revalidate: false }
      );
      toast({ title: "Settings saved", description: repo.full_name });
    },
    [activeTeamId, mutateRepos]
  );

  const restartRepoSandbox = useCallback(
    async (repo: Repo) => {
      await saveRepo(repo);
      const previousSandbox = getSandboxForRepo(repo.id);
      if (previousSandbox) await stopSandbox(previousSandbox.id);
      bindSessionToPendingSandboxBranch(
        useSessionsStore.getState().activeSessionId,
        previousSandbox?.working_branch ?? null
      );

      let launched: SandboxRecord | null | undefined;
      if (previousSandbox) {
        launched = await launchSandbox(repo.id, {
          repoId: repo.id,
          baseBranch: previousSandbox.base_branch,
          workingBranch: previousSandbox.working_branch,
          createBranch: false,
        });
      } else {
        await launchRepoSandbox(repo, {
          source: "project_settings",
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
    },
    [getSandboxForRepo, launchRepoSandbox, launchSandbox, saveRepo, stopSandbox]
  );

  return { saveRepo, restartRepoSandbox };
}
