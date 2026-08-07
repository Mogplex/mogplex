import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { flowSaveStatusAnnouncement } from "@/lib/flows/save-presentation";
import {
  serializePersistedFlowGraph,
  draftToGraph,
  type FlowDraftSnapshot,
} from "@/lib/flows/editor";
import type { Flow } from "@/lib/types";
import { isMacPrimaryModifier } from "./canvas-utils";

export type FlowSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface FlowDerivedStatusParams {
  draft: FlowDraftSnapshot | null;
  selectedFlow: Flow | null | undefined;
  selectedFlowId: string | null;
  dirty: boolean;
  saveStatus: FlowSaveStatus;
  saveError: string | null;
  savedInSessionFlowId: string | null;
  publishing: boolean;
  publishSucceeded: boolean;
}

export interface FlowDerivedStatusResult {
  primaryModifierLabel: string;
  saveStatusLabel: string;
  saveStatusTitle: string;
  quietSaveStatus: boolean;
  saveStatusTone: { container: string; dot?: string };
  saveStatusAnnouncement: string | null;
  hasUnpublishedGraphChanges: boolean;
  shouldPublishLatestDraft: boolean;
  primaryActionLabel: string;
  primaryActionClassName: string;
}

export function useFlowDerivedStatus(
  params: FlowDerivedStatusParams
): FlowDerivedStatusResult {
  const {
    draft,
    selectedFlow,
    selectedFlowId,
    dirty,
    saveStatus,
    saveError,
    savedInSessionFlowId,
    publishing,
    publishSucceeded,
  } = params;

  const primaryModifierLabel = useMemo(
    () => (isMacPrimaryModifier() ? "⌘" : "Ctrl+"),
    []
  );

  const saveStatusLabel = useMemo(() => {
    switch (saveStatus) {
      case "pending":
        return "Autosave queued";
      case "saving":
        return "Autosaving...";
      case "error":
        return "Save failed";
      default:
        return dirty ? "Unsaved changes" : "Saved";
    }
  }, [dirty, saveStatus]);

  const saveStatusTitle = saveError ?? saveStatusLabel;

  const quietSaveStatus =
    !dirty && (saveStatus === "saved" || saveStatus === "idle");

  const saveStatusTone = useMemo(() => {
    if (quietSaveStatus) {
      return { container: "text-muted-foreground" };
    }

    switch (saveStatus) {
      case "pending":
        return {
          container:
            "border-accent-amber/25 bg-accent-amber/[0.10] text-accent-amber",
          dot: "bg-accent-amber",
        };
      case "saving":
        return {
          container:
            "border-accent-blue/25 bg-accent-blue/[0.10] text-accent-blue",
          dot: "bg-accent-blue",
        };
      case "error":
        return {
          container:
            "border-accent-red/30 bg-accent-red/[0.08] text-accent-red",
          dot: "bg-accent-red",
        };
      case "saved":
      default:
        // Idle or saved can reach this branch only while the draft is dirty.
        return {
          container:
            "border-accent-amber/25 bg-accent-amber/[0.10] text-accent-amber",
          dot: "bg-accent-amber",
        };
    }
  }, [quietSaveStatus, saveStatus]);

  const saveStatusAnnouncement = flowSaveStatusAnnouncement({
    status: saveStatus,
    error: saveError,
    dirty,
    savedInSession: savedInSessionFlowId === selectedFlowId,
  });

  const hasUnpublishedGraphChanges = useMemo(() => {
    if (dirty || !draft || !selectedFlow?.published_version_id) {
      return false;
    }
    if (!selectedFlow.published_version) return true;
    return (
      serializePersistedFlowGraph(draftToGraph(draft)) !==
      serializePersistedFlowGraph(selectedFlow.published_version.graph)
    );
  }, [
    dirty,
    draft,
    selectedFlow?.published_version,
    selectedFlow?.published_version_id,
  ]);

  const shouldPublishLatestDraft =
    dirty || hasUnpublishedGraphChanges || !selectedFlow?.published_version_id;

  const primaryActionLabel = useMemo(() => {
    if (publishSucceeded && !dirty) {
      return "Published";
    }
    if (publishing) {
      return shouldPublishLatestDraft ? "Publishing..." : "Activating...";
    }
    if (selectedFlow?.status === "active") {
      return "Publish changes";
    }
    return shouldPublishLatestDraft ? "Publish & activate" : "Activate";
  }, [
    dirty,
    publishSucceeded,
    publishing,
    selectedFlow?.status,
    shouldPublishLatestDraft,
  ]);

  const primaryActionClassName = useMemo(
    () =>
      cn(
        "h-8 min-w-[92px] whitespace-nowrap rounded-md px-3 text-xs font-semibold shadow-lg sm:min-w-[96px]",
        publishSucceeded && !dirty
          ? "bg-accent-green text-white shadow-accent-green/25 hover:bg-accent-green/90"
          : "bg-primary text-primary-foreground shadow-primary/20 hover:bg-primary/90 hover:shadow-primary/30"
      ),
    [dirty, publishSucceeded]
  );

  return {
    primaryModifierLabel,
    saveStatusLabel,
    saveStatusTitle,
    quietSaveStatus,
    saveStatusTone,
    saveStatusAnnouncement,
    hasUnpublishedGraphChanges,
    shouldPublishLatestDraft,
    primaryActionLabel,
    primaryActionClassName,
  };
}
