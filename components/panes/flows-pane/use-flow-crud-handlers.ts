import { useCallback } from "react";
import type { KeyedMutator } from "swr";
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
  mutateFlows: KeyedMutator<Flow[]>;
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
        // Insert the server-returned flow without revalidating: a refetch
        // fired in this window can commit an in-flight pre-create response
        // (SWR dedupes concurrent requests per key), dropping the new flow
        // from the list and bouncing the selection away from it.
        const created = payload as Flow;
        await mutateFlows((current) => [...(current ?? []), created], {
          revalidate: false,
        });
        setBrowseInstallationId(createInstallationId);
        setBrowseRepositories(
          createRepository === "all" ? [] : [createRepository]
        );
        setSelectedFlowId(created.id);
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
      // Same stale-revalidation race as create: insert the copy without
      // refetching so the selection cannot bounce off a stale list.
      const duplicate = payload as Flow;
      await mutateFlows((current) => [...(current ?? []), duplicate], {
        revalidate: false,
      });
      setSelectedFlowId(duplicate.id);
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
      // Clear the selection and drop the flow from the list cache up front.
      // Awaiting a plain revalidation here can commit a stale in-flight
      // response that still contains the deleted flow (SWR dedupes concurrent
      // requests for the same key), which would reselect it.
      const deletedFlowId = selectedFlow.id;
      setSelectedFlowId((current) =>
        current === deletedFlowId ? null : current
      );
      await mutateFlows(
        (current) => current?.filter((flow) => flow.id !== deletedFlowId),
        { revalidate: true }
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
