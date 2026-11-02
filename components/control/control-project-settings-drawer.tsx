"use client";

import { ProjectSettingsDrawer } from "@/components/project-settings/project-settings-drawer";
import { useProjectSettingsDrawer } from "@/hooks/use-project-settings-drawer";

/** Control's single project settings drawer, driven by the shared store. */
export function ControlProjectSettingsDrawer() {
  const request = useProjectSettingsDrawer((state) => state.request);
  const setTab = useProjectSettingsDrawer((state) => state.setTab);
  const close = useProjectSettingsDrawer((state) => state.close);
  return (
    <ProjectSettingsDrawer
      repoId={request?.repoId ?? null}
      tab={request?.tab ?? "env"}
      requestedEnvNames={request?.requestedEnvNames}
      onTabChange={setTab}
      onClose={close}
    />
  );
}
