"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { dispatchSandboxLaunchIntent } from "@/lib/sandbox/launch-intent";
import { SandboxLaunchDialog } from "./sandbox-launch-dialog";
import { useSandboxLaunchForm } from "./use-sandbox-launch-form";
import type {
  LaunchOptions,
  LaunchOutcome,
  LaunchRepo,
  SandboxLaunchContextValue,
} from "./sandbox-launch-types";

const SandboxLaunchContext = createContext<SandboxLaunchContextValue | null>(
  null
);

export function SandboxLaunchProvider({ children }: { children: ReactNode }) {
  const launch = useSandboxStore((state) => state.launch);
  const resumeSandbox = useSandboxStore((state) => state.resume);
  const form = useSandboxLaunchForm();

  const launchRepoSandbox = useCallback(
    async (repo: LaunchRepo, options: LaunchOptions): Promise<LaunchOutcome> => {
      return dispatchSandboxLaunchIntent(repo, options, {
        launch,
        resumeSandbox,
        requestLaunchChoice: form.requestLaunchChoice,
        getSandboxById(recordId) {
          return useSandboxStore.getState().getSandboxById(recordId);
        },
      });
    },
    [launch, form.requestLaunchChoice, resumeSandbox]
  );

  const contextValue = useMemo<SandboxLaunchContextValue>(
    () => ({
      launchRepoSandbox,
    }),
    [launchRepoSandbox]
  );

  return (
    <SandboxLaunchContext.Provider value={contextValue}>
      {children}
      <SandboxLaunchDialog form={form} />
    </SandboxLaunchContext.Provider>
  );
}

export function useSandboxLaunchActions() {
  const context = useContext(SandboxLaunchContext);
  if (!context) {
    throw new Error(
      "useSandboxLaunchActions must be used inside SandboxLaunchProvider"
    );
  }
  return context;
}
