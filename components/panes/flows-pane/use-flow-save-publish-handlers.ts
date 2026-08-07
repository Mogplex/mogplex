import { useCallback } from "react";
import { toast } from "@/hooks/use-toast";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import {
  cloneFlowDraftSnapshot,
  draftToGraph,
  serializePersistedFlowDraft,
  type FlowDraftSnapshot,
} from "@/lib/flows/editor";
import type { Flow } from "@/lib/types";
import type { PersistFlowOptions } from "./types";
import type { FlowDraftHistory } from "./use-flow-save-publish-state";
import { HISTORY_LIMIT } from "./constants";

export type FlowSavePublishHandlersDeps = {
  // State from useFlowSavePublishState
  setHistory: React.Dispatch<React.SetStateAction<FlowDraftHistory | null>>;
  setBaselineDraft: (draft: FlowDraftSnapshot | null) => void;
  setSaving: (saving: boolean) => void;
  setSaveStatus: (
    status: "idle" | "pending" | "saving" | "saved" | "error"
  ) => void;
  setSaveError: (error: string | null) => void;
  setSavedInSessionFlowId: (id: string | null) => void;
  setPublishing: (publishing: boolean) => void;
  setPublishSucceeded: (succeeded: boolean) => void;
  autosaveTimeoutRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>;
  publishStateTimeoutRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>;
  autosaveAttemptSignatureRef: React.MutableRefObject<string | null>;
  historyMergeRef: React.MutableRefObject<{
    mergeKey: string | null;
    lastAt: number;
  }>;
  // Props
  selectedFlow: Flow | undefined;
  draft: FlowDraftSnapshot | null;
  dirty: boolean;
  publishing: boolean;
  saving: boolean;
  activeTeamId: string | null;
  // Mutators
  mutateFlows: () => Promise<Flow[] | undefined>;
  mutateSelectedFlow: () => Promise<Flow | undefined>;
  // Constants
  publishSuccessStateMs: number;
};

export type FlowSavePublishHandlers = {
  persistFlow: (options?: PersistFlowOptions) => Promise<boolean>;
  publishFlow: () => Promise<void>;
  toggleFlowStatus: () => Promise<void>;
  undoDraft: () => void;
  redoDraft: () => void;
  resetHistoryMerge: () => void;
};

/**
 * Handlers for save, publish, undo/redo, and flow status toggling.
 */
export function useFlowSavePublishHandlers(
  deps: FlowSavePublishHandlersDeps
): FlowSavePublishHandlers {
  const {
    setHistory,
    setBaselineDraft,
    setSaving,
    setSaveStatus,
    setSaveError,
    setSavedInSessionFlowId,
    setPublishing,
    setPublishSucceeded,
    autosaveTimeoutRef,
    publishStateTimeoutRef,
    autosaveAttemptSignatureRef,
    historyMergeRef,
    selectedFlow,
    draft,
    dirty,
    publishing,
    saving,
    activeTeamId,
    mutateFlows,
    mutateSelectedFlow,
    publishSuccessStateMs,
  } = deps;

  const resetHistoryMerge = useCallback(() => {
    historyMergeRef.current = { mergeKey: null, lastAt: 0 };
  }, [historyMergeRef]);

  const undoDraft = useCallback(() => {
    resetHistoryMerge();
    setHistory((current) => {
      if (!current || current.past.length === 0) return current;
      const previous = current.past[current.past.length - 1];
      return {
        past: current.past.slice(0, -1),
        present: cloneFlowDraftSnapshot(previous),
        future: [
          cloneFlowDraftSnapshot(current.present),
          ...current.future,
        ].slice(0, HISTORY_LIMIT),
      };
    });
  }, [resetHistoryMerge, setHistory]);

  const redoDraft = useCallback(() => {
    resetHistoryMerge();
    setHistory((current) => {
      if (!current || current.future.length === 0) return current;
      const [next, ...rest] = current.future;
      return {
        past: [...current.past, cloneFlowDraftSnapshot(current.present)].slice(
          -HISTORY_LIMIT
        ),
        present: cloneFlowDraftSnapshot(next),
        future: rest,
      };
    });
  }, [resetHistoryMerge, setHistory]);

  const persistFlow = useCallback(
    async (options?: PersistFlowOptions): Promise<boolean> => {
      if (!selectedFlow || !draft) return false;
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }

      const snapshot = cloneFlowDraftSnapshot(options?.snapshot ?? draft);
      const snapshotSignature = serializePersistedFlowDraft(snapshot);
      autosaveAttemptSignatureRef.current = snapshotSignature;

      setSaving(true);
      setSaveStatus("saving");
      setSaveError(null);
      try {
        const response = await fetch(`/api/flows/${selectedFlow.id}`, {
          method: "PUT",
          headers: getActiveTeamRequestHeaders(
            { "Content-Type": "application/json" },
            activeTeamId
          ),
          body: JSON.stringify({
            name: snapshot.name,
            description: snapshot.description,
            notes: snapshot.notes,
            draft_graph: draftToGraph(snapshot),
          }),
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Failed to save flow");
        }

        setBaselineDraft(cloneFlowDraftSnapshot(snapshot));
        setSavedInSessionFlowId(selectedFlow.id);
        setSaveStatus("saved");
        autosaveAttemptSignatureRef.current = null;
        await Promise.all([mutateSelectedFlow(), mutateFlows()]);
        if (!options?.silentSuccess) {
          toast({
            title: "Draft saved",
            description: "The latest workflow changes are stored.",
          });
        }
        return true;
      } catch (error) {
        const description =
          error instanceof Error ? error.message : "Failed to save flow";
        setSaveStatus("error");
        setSaveError(description);
        toast({
          title: "Error",
          description,
          variant: "destructive",
        });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [
      activeTeamId,
      autosaveAttemptSignatureRef,
      autosaveTimeoutRef,
      draft,
      mutateFlows,
      mutateSelectedFlow,
      selectedFlow,
      setBaselineDraft,
      setSavedInSessionFlowId,
      setSaveError,
      setSaveStatus,
      setSaving,
    ]
  );

  const publishFlow = useCallback(async () => {
    if (!selectedFlow || publishing || saving) return;
    const wasActive = selectedFlow.status === "active";
    setPublishing(true);
    setPublishSucceeded(false);
    try {
      const saved = dirty
        ? await persistFlow({
            reason: "publish",
            silentSuccess: true,
            snapshot: draft ? cloneFlowDraftSnapshot(draft) : undefined,
          })
        : true;
      if (!saved) return;
      const response = await fetch(`/api/flows/${selectedFlow.id}/publish`, {
        method: "POST",
        headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to publish flow");
      }
      await Promise.all([mutateSelectedFlow(), mutateFlows()]);
      setPublishSucceeded(true);
      if (publishStateTimeoutRef.current) {
        clearTimeout(publishStateTimeoutRef.current);
      }
      publishStateTimeoutRef.current = setTimeout(() => {
        setPublishSucceeded(false);
        publishStateTimeoutRef.current = null;
      }, publishSuccessStateMs);
      toast({
        title: wasActive
          ? "Published to live workflow"
          : "Flow published and activated",
        description: wasActive
          ? "Webhook routing now points at the newest saved draft."
          : "This workflow is now live and will receive matching events.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to publish flow",
        variant: "destructive",
      });
    } finally {
      setPublishing(false);
    }
  }, [
    activeTeamId,
    dirty,
    draft,
    mutateFlows,
    mutateSelectedFlow,
    persistFlow,
    publishStateTimeoutRef,
    publishing,
    publishSuccessStateMs,
    saving,
    selectedFlow,
    setPublishSucceeded,
    setPublishing,
  ]);

  const toggleFlowStatus = useCallback(async () => {
    if (!selectedFlow) return;
    try {
      const nextStatus =
        selectedFlow.status === "active" ? "inactive" : "active";
      const response = await fetch(`/api/flows/${selectedFlow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update flow status");
      }
      await Promise.all([mutateSelectedFlow(), mutateFlows()]);
      toast({
        title: nextStatus === "active" ? "Flow activated" : "Flow deactivated",
        description:
          nextStatus === "active"
            ? "Webhook routing is live for the current published version."
            : "Webhook routing is paused until you reactivate this flow.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to update flow status",
        variant: "destructive",
      });
    }
  }, [mutateFlows, mutateSelectedFlow, selectedFlow]);

  return {
    persistFlow,
    publishFlow,
    toggleFlowStatus,
    undoDraft,
    redoDraft,
    resetHistoryMerge,
  };
}
