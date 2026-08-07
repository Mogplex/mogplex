import { useCallback } from "react";
import { toast } from "@/hooks/use-toast";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import {
  cloneFlowDraftSnapshot,
  type FlowDraftSnapshot,
} from "@/lib/flows/editor";
import type { Flow, PersonalFlowTemplatePage } from "@/lib/types";
import type { PersistFlowOptions } from "./types";
import type { TemplateDeleteTarget } from "./use-flow-template-state";

export type FlowTemplateHandlersDeps = {
  // Template state from useFlowTemplateState
  saveTemplateName: string;
  saveTemplateScope: "personal" | "team";
  savingTemplate: boolean;
  setSavingTemplate: (saving: boolean) => void;
  setSaveTemplateOpen: (open: boolean) => void;
  setTemplatePickerOpen: (open: boolean) => void;
  templateDeleteTarget: TemplateDeleteTarget | null;
  setTemplateDeleteTarget: (target: TemplateDeleteTarget | null) => void;
  deletingTemplate: boolean;
  setDeletingTemplate: (deleting: boolean) => void;
  // Template mutators
  setPersonalTemplatePageCount: (
    count: number | ((_size: number) => number)
  ) => Promise<PersonalFlowTemplatePage[] | undefined>;
  setTeamTemplatePageCount: (
    count: number | ((_size: number) => number)
  ) => Promise<PersonalFlowTemplatePage[] | undefined>;
  mutatePersonalTemplates: () => Promise<
    PersonalFlowTemplatePage[] | undefined
  >;
  mutateTeamTemplates: () => Promise<PersonalFlowTemplatePage[] | undefined>;
  // Other deps
  selectedFlow: Flow | undefined;
  draft: FlowDraftSnapshot | null;
  dirty: boolean;
  activeTeamId: string | null;
  persistFlow: (options?: PersistFlowOptions) => Promise<boolean>;
};

export type FlowTemplateHandlers = {
  saveSelectedFlowAsTemplate: () => Promise<void>;
  deleteSavedTemplate: () => Promise<void>;
};

/**
 * Handlers for saving and deleting workflow templates.
 */
export function useFlowTemplateHandlers(
  deps: FlowTemplateHandlersDeps
): FlowTemplateHandlers {
  const {
    saveTemplateName,
    saveTemplateScope,
    savingTemplate,
    setSavingTemplate,
    setSaveTemplateOpen,
    setTemplatePickerOpen,
    templateDeleteTarget,
    setTemplateDeleteTarget,
    deletingTemplate,
    setDeletingTemplate,
    setPersonalTemplatePageCount,
    setTeamTemplatePageCount,
    mutatePersonalTemplates,
    mutateTeamTemplates,
    selectedFlow,
    draft,
    dirty,
    activeTeamId,
    persistFlow,
  } = deps;

  const saveSelectedFlowAsTemplate = useCallback(async () => {
    if (!selectedFlow || !saveTemplateName.trim() || savingTemplate) return;
    setSavingTemplate(true);
    try {
      const saved = dirty
        ? await persistFlow({
            reason: "template",
            silentSuccess: true,
            snapshot: draft ? cloneFlowDraftSnapshot(draft) : undefined,
          })
        : true;
      if (!saved) return;

      const savingToTeam = saveTemplateScope === "team";
      const response = await fetch("/api/flows/templates", {
        method: "POST",
        headers: savingToTeam
          ? getActiveTeamRequestHeaders(
              { "Content-Type": "application/json" },
              activeTeamId
            )
          : { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow_id: selectedFlow.id,
          name: saveTemplateName.trim(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save workflow template");
      }
      if (savingToTeam) {
        await setTeamTemplatePageCount(1);
        await mutateTeamTemplates();
      } else {
        await setPersonalTemplatePageCount(1);
        await mutatePersonalTemplates();
      }
      setSaveTemplateOpen(false);
      setTemplatePickerOpen(true);
      toast({
        title: savingToTeam ? "Team template saved" : "Template saved",
        description: payload.reconnect?.length
          ? savingToTeam
            ? "Private agents and connection-specific settings were removed and will be requested when reused."
            : "Connection-specific settings were removed and will be requested when reused."
          : savingToTeam
            ? "This workflow is now available to your active team."
            : "This workflow can now be reused from Quick start.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to save workflow template",
        variant: "destructive",
      });
    } finally {
      setSavingTemplate(false);
    }
  }, [
    activeTeamId,
    dirty,
    draft,
    mutatePersonalTemplates,
    mutateTeamTemplates,
    persistFlow,
    saveTemplateName,
    saveTemplateScope,
    savingTemplate,
    selectedFlow,
    setPersonalTemplatePageCount,
    setSaveTemplateOpen,
    setSavingTemplate,
    setTeamTemplatePageCount,
    setTemplatePickerOpen,
  ]);

  const deleteSavedTemplate = useCallback(async () => {
    if (!templateDeleteTarget || deletingTemplate) return;
    setDeletingTemplate(true);
    try {
      const response = await fetch(
        `/api/flows/templates/${encodeURIComponent(
          templateDeleteTarget.template.id
        )}`,
        {
          method: "DELETE",
          headers:
            templateDeleteTarget.scope === "team"
              ? getActiveTeamRequestHeaders(undefined, activeTeamId)
              : undefined,
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete workflow template");
      }
      await (templateDeleteTarget.scope === "team"
        ? mutateTeamTemplates()
        : mutatePersonalTemplates());
      toast({
        title: "Template deleted",
        description: `"${templateDeleteTarget.template.name}" was permanently deleted.`,
        variant: "destructive",
      });
      setTemplateDeleteTarget(null);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to delete workflow template",
        variant: "destructive",
      });
    } finally {
      setDeletingTemplate(false);
    }
  }, [
    activeTeamId,
    deletingTemplate,
    mutatePersonalTemplates,
    mutateTeamTemplates,
    setDeletingTemplate,
    setTemplateDeleteTarget,
    templateDeleteTarget,
  ]);

  return {
    saveSelectedFlowAsTemplate,
    deleteSavedTemplate,
  };
}
