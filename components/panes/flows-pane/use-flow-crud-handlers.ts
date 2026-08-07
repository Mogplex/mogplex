import { useCallback } from "react";
import { toast } from "@/hooks/use-toast";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import {
  FLOW_STARTER_TEMPLATES,
  type FlowStarterTemplateId,
} from "@/lib/flows/templates";
import type { Flow, PersonalFlowTemplate } from "@/lib/types";

export type FlowCrudHandlersDeps = {
  // Create/browse state
  createInstallationId: string;
  createRepository: string;
  setIsCreating: (creating: boolean) => void;
  setBrowseInstallationId: (id: string) => void;
  setBrowseRepositories: (repos: string[]) => void;
  setSelectedFlowId: React.Dispatch<React.SetStateAction<string | null>>;
  setTemplatePickerOpen: (open: boolean) => void;
  // Props
  selectedFlow: Flow | undefined;
  activeTeamId: string | null;
  // Mutators
  mutateFlows: () => Promise<Flow[] | undefined>;
};

export type FlowCrudHandlers = {
  createFlow: (
    templateId: FlowStarterTemplateId | null,
    savedTemplate?: PersonalFlowTemplate,
    savedTemplateScope?: "personal" | "team"
  ) => Promise<void>;
  duplicateSelectedFlow: () => Promise<void>;
  deleteSelectedFlow: () => Promise<void>;
};

/**
 * Handlers for creating, duplicating, and deleting flows.
 */
export function useFlowCrudHandlers(
  deps: FlowCrudHandlersDeps
): FlowCrudHandlers {
  const {
    createInstallationId,
    createRepository,
    setIsCreating,
    setBrowseInstallationId,
    setBrowseRepositories,
    setSelectedFlowId,
    setTemplatePickerOpen,
    selectedFlow,
    activeTeamId,
    mutateFlows,
  } = deps;

  const createFlow = useCallback(
    async (
      templateId: FlowStarterTemplateId | null,
      savedTemplate?: PersonalFlowTemplate,
      savedTemplateScope: "personal" | "team" = "personal"
    ) => {
      if (!createInstallationId) return;
      if (savedTemplate?.requires_repository && createRepository === "all") {
        toast({
          title: "Choose a repository",
          description:
            "This template uses a trigger that must target one repository.",
          variant: "destructive",
        });
        return;
      }
      setIsCreating(true);
      try {
        const response = await fetch("/api/flows", {
          method: "POST",
          headers:
            savedTemplateScope === "team"
              ? getActiveTeamRequestHeaders(
                  { "Content-Type": "application/json" },
                  activeTeamId
                )
              : { "Content-Type": "application/json" },
          body: JSON.stringify({
            installation_id: Number(createInstallationId),
            template_id: templateId,
            personal_template_id:
              savedTemplateScope === "personal"
                ? (savedTemplate?.id ?? null)
                : null,
            team_template_id:
              savedTemplateScope === "team"
                ? (savedTemplate?.id ?? null)
                : null,
            repo_full_name:
              createRepository === "all" ? null : createRepository,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Failed to create flow");
        }
        await mutateFlows();
        setBrowseInstallationId(createInstallationId);
        setBrowseRepositories(
          createRepository === "all" ? [] : [createRepository]
        );
        setSelectedFlowId(payload.id);
        setTemplatePickerOpen(false);
        const template =
          savedTemplate ??
          FLOW_STARTER_TEMPLATES.find((entry) => entry.id === templateId);
        toast({
          title: "Workflow created",
          description: template ? `Started from ${template.name}.` : undefined,
        });
      } catch (error) {
        toast({
          title: "Error",
          description:
            error instanceof Error ? error.message : "Failed to create flow",
          variant: "destructive",
        });
      } finally {
        setIsCreating(false);
      }
    },
    [
      activeTeamId,
      createInstallationId,
      createRepository,
      mutateFlows,
      setBrowseInstallationId,
      setBrowseRepositories,
      setIsCreating,
      setSelectedFlowId,
      setTemplatePickerOpen,
    ]
  );

  const duplicateSelectedFlow = useCallback(async () => {
    if (!selectedFlow) return;
    try {
      const response = await fetch(`/api/flows/${selectedFlow.id}/duplicate`, {
        method: "POST",
        headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to duplicate flow");
      }
      await mutateFlows();
      setSelectedFlowId(payload.id);
      toast({ title: "Flow duplicated" });
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to duplicate flow",
        variant: "destructive",
      });
    }
  }, [activeTeamId, mutateFlows, selectedFlow, setSelectedFlowId]);

  const deleteSelectedFlow = useCallback(async () => {
    if (!selectedFlow) return;
    // eslint-disable-next-line no-alert -- intentional destructive action confirmation
    if (!window.confirm(`Delete "${selectedFlow.name}"?`)) return;

    try {
      const response = await fetch(`/api/flows/${selectedFlow.id}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to delete flow");
      }
      await mutateFlows();
      setSelectedFlowId((current) =>
        current === selectedFlow.id ? null : current
      );
      toast({
        title: "Workflow deleted",
        description: `"${selectedFlow.name}" was permanently deleted.`,
        variant: "destructive",
      });
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to delete flow",
        variant: "destructive",
      });
    }
  }, [mutateFlows, selectedFlow, setSelectedFlowId]);

  return {
    createFlow,
    duplicateSelectedFlow,
    deleteSelectedFlow,
  };
}
