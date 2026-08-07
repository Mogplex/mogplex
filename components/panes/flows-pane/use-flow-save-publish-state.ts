import { useEffect, useMemo, useRef, useState } from "react";
import type { Flow } from "@/lib/types";
import type { FlowDraftSnapshot } from "@/lib/flows/editor";
import {
  cloneFlowDraftSnapshot,
  createFlowDraftSnapshot,
  serializePersistedFlowDraft,
} from "@/lib/flows/editor";
import { shouldHydrateFlowDraftFromServer } from "@/lib/flows/draft-sync";
import type { FlowSaveStatus } from "@/lib/flows/save-presentation";
import { createDraftHistory } from "./canvas-utils";

export type FlowDraftHistory = {
  past: FlowDraftSnapshot[];
  present: FlowDraftSnapshot;
  future: FlowDraftSnapshot[];
};

export type FlowSavePublishState = {
  // History for undo/redo
  history: FlowDraftHistory | null;
  setHistory: React.Dispatch<React.SetStateAction<FlowDraftHistory | null>>;
  baselineDraft: FlowDraftSnapshot | null;
  setBaselineDraft: (draft: FlowDraftSnapshot | null) => void;
  // Save state
  saving: boolean;
  setSaving: (saving: boolean) => void;
  saveStatus: FlowSaveStatus;
  setSaveStatus: (status: FlowSaveStatus) => void;
  saveError: string | null;
  setSaveError: (error: string | null) => void;
  savedInSessionFlowId: string | null;
  setSavedInSessionFlowId: (id: string | null) => void;
  // Publish state
  publishing: boolean;
  setPublishing: (publishing: boolean) => void;
  publishSucceeded: boolean;
  setPublishSucceeded: (succeeded: boolean) => void;
  // Derived values
  draft: FlowDraftSnapshot | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  baselineDraftSignature: string | null;
  // Refs for external consumers
  historyMergeRef: React.MutableRefObject<{
    mergeKey: string | null;
    lastAt: number;
  }>;
  autosaveTimeoutRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>;
  publishStateTimeoutRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>;
  autosaveAttemptSignatureRef: React.MutableRefObject<string | null>;
  hydratedFlowIdRef: React.MutableRefObject<string | null>;
  // Mirror refs for hydration effect reads
  dirtyRef: React.MutableRefObject<boolean>;
  historyRef: React.MutableRefObject<FlowDraftHistory | null>;
  baselineDraftRef: React.MutableRefObject<FlowDraftSnapshot | null>;
  baselineDraftSignatureRef: React.MutableRefObject<string | null>;
};

export type FlowSavePublishStateParams = {
  selectedFlow: Flow | undefined;
  setContextMenu: (menu: null) => void;
};

/**
 * Manages draft history, save/publish state, and related refs for the flow editor.
 * Handles hydration from server, dirty tracking, and undo/redo capability.
 */
export function useFlowSavePublishState({
  selectedFlow,
  setContextMenu,
}: FlowSavePublishStateParams): FlowSavePublishState {
  const [history, setHistory] = useState<FlowDraftHistory | null>(null);
  const [baselineDraft, setBaselineDraft] = useState<FlowDraftSnapshot | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishSucceeded, setPublishSucceeded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<FlowSaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedInSessionFlowId, setSavedInSessionFlowId] = useState<
    string | null
  >(null);

  // Refs for history merge window and timeouts
  const historyMergeRef = useRef<{ mergeKey: string | null; lastAt: number }>({
    mergeKey: null,
    lastAt: 0,
  });
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishStateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const autosaveAttemptSignatureRef = useRef<string | null>(null);
  const hydratedFlowIdRef = useRef<string | null>(null);

  const draft = history?.present ?? null;
  const dirty = useMemo(
    () =>
      draft && baselineDraft
        ? serializePersistedFlowDraft(draft) !==
          serializePersistedFlowDraft(baselineDraft)
        : false,
    [baselineDraft, draft]
  );
  const baselineDraftSignature = useMemo(
    () => (baselineDraft ? serializePersistedFlowDraft(baselineDraft) : null),
    [baselineDraft]
  );
  const canUndo = (history?.past.length ?? 0) > 0;
  const canRedo = (history?.future.length ?? 0) > 0;

  // Refs mirror local draft state so the hydration effect can read the latest values
  // without re-running on every keystroke or on intermediate renders during persistFlow
  // (e.g. after setBaselineDraft() but before mutateSelectedFlow() refreshes selectedFlow).
  const dirtyRef = useRef(dirty);
  const historyRef = useRef(history);
  const baselineDraftRef = useRef(baselineDraft);
  const baselineDraftSignatureRef = useRef(baselineDraftSignature);

  // Declaration order is load-bearing: this ref-sync effect MUST stay above the
  // hydration effect below. React fires effects in declaration order within a commit,
  // so if a render updates both `selectedFlow` and the mirrored draft state in the same
  // commit, the hydration effect would read stale ref values if this block were moved
  // or hoisted beneath it. (First render is safe because `useRef(value)` captures the
  // current value, but any subsequent co-change would race.)
  useEffect(() => {
    dirtyRef.current = dirty;
    historyRef.current = history;
    baselineDraftRef.current = baselineDraft;
    baselineDraftSignatureRef.current = baselineDraftSignature;
  });

  // Hydrate draft from server when flow changes or server draft changes
  useEffect(() => {
    if (!selectedFlow) return;
    const nextDraft = createFlowDraftSnapshot(selectedFlow);
    const flowChanged = hydratedFlowIdRef.current !== selectedFlow.id;
    const shouldHydrate = shouldHydrateFlowDraftFromServer({
      currentFlowId: hydratedFlowIdRef.current,
      incomingFlowId: selectedFlow.id,
      hasDraftHistory: Boolean(historyRef.current),
      hasBaselineDraft: Boolean(baselineDraftRef.current),
      dirty: dirtyRef.current,
      currentBaselineSignature: baselineDraftSignatureRef.current,
      incomingSignature: serializePersistedFlowDraft(nextDraft),
    });
    hydratedFlowIdRef.current = selectedFlow.id;
    if (flowChanged) {
      setSavedInSessionFlowId(null);
    }
    if (!shouldHydrate) {
      return;
    }

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
    if (publishStateTimeoutRef.current) {
      clearTimeout(publishStateTimeoutRef.current);
      publishStateTimeoutRef.current = null;
    }
    setHistory(createDraftHistory(nextDraft));
    setBaselineDraft(cloneFlowDraftSnapshot(nextDraft));
    setContextMenu(null);
    setSaving(false);
    setPublishing(false);
    setPublishSucceeded(false);
    setSaveStatus("saved");
    setSaveError(null);
    autosaveAttemptSignatureRef.current = null;
    historyMergeRef.current = { mergeKey: null, lastAt: 0 };
  }, [selectedFlow, setContextMenu]);

  // Cleanup timeouts on unmount
  useEffect(
    () => () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
      if (publishStateTimeoutRef.current) {
        clearTimeout(publishStateTimeoutRef.current);
      }
    },
    []
  );

  // Clear publish succeeded state when draft becomes dirty
  useEffect(() => {
    if (!publishSucceeded || !dirty) return;
    setPublishSucceeded(false);
    if (publishStateTimeoutRef.current) {
      clearTimeout(publishStateTimeoutRef.current);
      publishStateTimeoutRef.current = null;
    }
  }, [dirty, publishSucceeded]);

  return {
    history,
    setHistory,
    baselineDraft,
    setBaselineDraft,
    saving,
    setSaving,
    saveStatus,
    setSaveStatus,
    saveError,
    setSaveError,
    savedInSessionFlowId,
    setSavedInSessionFlowId,
    publishing,
    setPublishing,
    publishSucceeded,
    setPublishSucceeded,
    draft,
    dirty,
    canUndo,
    canRedo,
    baselineDraftSignature,
    historyMergeRef,
    autosaveTimeoutRef,
    publishStateTimeoutRef,
    autosaveAttemptSignatureRef,
    hydratedFlowIdRef,
    dirtyRef,
    historyRef,
    baselineDraftRef,
    baselineDraftSignatureRef,
  };
}
