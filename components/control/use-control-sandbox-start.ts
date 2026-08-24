"use client";

import { useCallback } from "react";
import { useSandboxLaunchActions } from "@/components/sandbox-launch-provider";
import { toast } from "@/hooks/use-toast";
import type { Repo } from "@/lib/types";

export function useControlSandboxStart(activeRepo: Repo | null) {
  const { launchRepoSandbox } = useSandboxLaunchActions();

  return useCallback(() => {
    if (!activeRepo) {
      toast({
        title: "No repository connected",
        description: "Connect a repository before starting a sandbox.",
        variant: "destructive",
      });
      return;
    }
    void launchRepoSandbox(activeRepo, {
      source: "control",
      trigger: "control-start-sandbox",
      intent: { kind: "start_fresh", interactive: true },
    });
  }, [activeRepo, launchRepoSandbox]);
}
