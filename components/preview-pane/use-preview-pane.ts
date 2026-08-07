"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  deriveSandboxHealthStatus,
  useSandboxHealth,
} from "@/hooks/use-sandbox-health";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { useSessionsStore } from "@/hooks/use-sessions";
import { getPreviewFileSelectionResetState } from "@/lib/preview-pane-state";
import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import {
  createSandboxLaunchAttemptId,
  shouldShowSandboxLaunchError,
} from "@/lib/sandbox/error-state";
import { buildSandboxObservabilityHref } from "@/lib/sandbox/navigation";
import {
  derivePreviewOverlayStatus,
  type PreviewOverlayStatus,
} from "@/lib/sandbox/preview-overlay-status";
import {
  getSandboxUiHealthStatus,
  isSandboxUiRuntimeRunning,
  resolveSandboxUiBundle,
} from "@/lib/sandbox/ui-state";
import { usePreviewFeedbackStore } from "@/hooks/use-preview-feedback";
import { trackActivation } from "@/lib/activation-tracking";
import {
  bindSessionToPendingSandboxBranch,
  ensureSessionSandboxBinding,
} from "@/lib/sandbox/session-retarget";
import { useSandboxLaunchActions } from "@/components/sandbox-launch-provider";
import { resolvePreviewPaneLaunchContext } from "@/lib/sandbox/preview-launch-context";
import type { PreviewPaneProps, SelectionRect } from "./types";
import { describeRegion } from "./utils";
import { reconcileSandbox } from "./reconcile-sandbox";

const STARTING_STALE_TIMEOUT_MS = 120_000;

export function usePreviewPane(props: PreviewPaneProps) {
  const {
    previewUrl,
    sandboxRecordId,
    sandboxCreating,
    sandboxError,
    sandboxId,
    activeRepo,
    initialTab,
    activeFilePath,
    onActiveFileChange,
    onTabChange,
    onPopOut,
  } = props;

  const router = useRouter();
  const { scope } = useParams<{ scope: string }>();
  const activeFile = activeFilePath ?? null;
  const [refreshKey, setRefreshKey] = useState(0);
  const [grabMode, setGrabMode] = useState(false);
  const [capturedRegion, setCapturedRegion] = useState<SelectionRect | null>(
    null
  );
  const sendFeedback = usePreviewFeedbackStore((s) => s.send);
  const activeSessionId = useSessionsStore((s) => s.activeSessionId);
  const activeTab = initialTab ?? "preview";

  const repoId = activeRepo?.id;
  const sandboxRecord = useSandboxStore((s) =>
    sandboxRecordId
      ? s.getSandboxById(sandboxRecordId)
      : repoId
        ? s.getSandboxForRepo(repoId)
        : null
  );
  const restartSandbox = useSandboxStore((s) => s.restart);
  const stopSandbox = useSandboxStore((s) => s.stop);
  const pauseSandbox = useSandboxStore((s) => s.pause);
  const resumeSandbox = useSandboxStore((s) => s.resume);
  const launchLogs = useSandboxStore((s) => {
    if (!repoId) return undefined;
    return s.getLaunchLogs(
      repoId,
      sandboxRecordId
        ? { sandboxId: sandboxRecordId }
        : props.workingBranch
          ? { workingBranch: props.workingBranch }
          : undefined
    );
  });
  const { launchRepoSandbox } = useSandboxLaunchActions();
  const onActiveFileChangeRef = useRef(onActiveFileChange);
  const trackedSandboxIdRef = useRef(sandboxId ?? null);
  const activeRepoRef = useRef(activeRepo);
  const sandboxRecordIdRef = useRef(sandboxRecordId);
  const effectiveSandboxRecordId = sandboxRecordId ?? sandboxRecord?.id ?? null;
  const [stoppedOverlayLaunchAttempt, setStoppedOverlayLaunchAttempt] =
    useState<{
      repoId: string | undefined;
      sandboxRecordId: string | null;
      launchAttemptId: string;
    } | null>(null);
  const stoppedOverlayLaunchAttemptId =
    stoppedOverlayLaunchAttempt &&
    stoppedOverlayLaunchAttempt.repoId === repoId &&
    stoppedOverlayLaunchAttempt.sandboxRecordId === effectiveSandboxRecordId
      ? stoppedOverlayLaunchAttempt.launchAttemptId
      : null;

  useEffect(() => {
    onActiveFileChangeRef.current = onActiveFileChange;
  }, [onActiveFileChange]);

  useEffect(() => {
    activeRepoRef.current = activeRepo;
    sandboxRecordIdRef.current = sandboxRecordId;
  }, [activeRepo, sandboxRecordId]);

  // Reset file selection when sandbox changes
  useEffect(() => {
    const nextSelectionState = getPreviewFileSelectionResetState(
      trackedSandboxIdRef.current,
      sandboxId
    );
    trackedSandboxIdRef.current = nextSelectionState.trackedSandboxId;
    if (!nextSelectionState.shouldClearActiveFile) return;
    onActiveFileChangeRef.current?.(null);
  }, [sandboxId]);

  const { status, reconcileHealth } = useSandboxHealth({
    sandboxRecordId,
    enabled: Boolean(sandboxRecordId),
  });

  // Resolve UI state and overlay status from a single traversal
  const { state: sandboxUiState, overlayStatus: resolvedOverlayStatus } =
    resolveSandboxUiBundle({
      session: null,
      record: sandboxRecord,
      liveProbe: status,
    });
  const resolvedHealthStatus = getSandboxUiHealthStatus(sandboxUiState);
  const shouldShowLaunchError = shouldShowSandboxLaunchError({
    error: sandboxError,
    overlayStatus: resolvedOverlayStatus,
    stoppedOverlayLaunchAttemptId,
  });
  const preResolverOverride: SandboxHealthStatus | null = (() => {
    if (shouldShowLaunchError) return "error";
    if (sandboxCreating && !sandboxRecord) return "starting";
    if (!sandboxRecordId) return "not_available";
    return null;
  })();
  const effectiveStatus: SandboxHealthStatus =
    preResolverOverride ?? resolvedHealthStatus;
  const overlayStatus: PreviewOverlayStatus = preResolverOverride
    ? derivePreviewOverlayStatus(preResolverOverride, sandboxRecord)
    : resolvedOverlayStatus;

  const isRunning =
    preResolverOverride === null && isSandboxUiRuntimeRunning(sandboxUiState);
  const isPaused =
    preResolverOverride === null && sandboxUiState.kind === "paused";
  const showOverlay =
    overlayStatus !== "running" && overlayStatus !== "idle_warning";

  // Staleness timer for starting state
  const [startingStale, setStartingStale] = useState(false);
  useEffect(() => {
    if (overlayStatus !== "starting") return;
    const timer = setTimeout(() => {
      setStartingStale(true);
    }, STARTING_STALE_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      setStartingStale(false);
    };
  }, [overlayStatus]);

  // Auto-refresh iframe on status transition to running
  const [prevEffectiveStatus, setPrevEffectiveStatus] =
    useState(effectiveStatus);
  if (prevEffectiveStatus !== effectiveStatus) {
    setPrevEffectiveStatus(effectiveStatus);
    if (effectiveStatus === "running") {
      setRefreshKey((k) => k + 1);
    }
  }

  const handlePause = useCallback(async () => {
    if (!sandboxRecordId) return;
    await pauseSandbox(sandboxRecordId);
  }, [pauseSandbox, sandboxRecordId]);

  const handleStop = useCallback(async () => {
    if (!sandboxRecordId) return;
    // eslint-disable-next-line no-alert -- intentional confirmation dialog
    const confirmed = window.confirm(
      "Stop this development environment? Unsaved state will be lost."
    );
    if (!confirmed) return;
    await stopSandbox(sandboxRecordId);
  }, [sandboxRecordId, stopSandbox]);

  const handleResume = useCallback(async () => {
    if (!sandboxRecordId) return;
    await resumeSandbox(sandboxRecordId);
  }, [resumeSandbox, sandboxRecordId]);

  const handleRestart = useCallback(async () => {
    if (!repoId || !sandboxRecordId) return;

    bindSessionToPendingSandboxBranch(
      activeSessionId,
      sandboxRecord?.working_branch ?? null
    );
    const restartedSandbox = await restartSandbox(repoId, {
      sandboxId: sandboxRecordId,
    });
    if (!restartedSandbox?.id) return;

    ensureSessionSandboxBinding(
      activeSessionId,
      sandboxRecordId,
      restartedSandbox.id
    );
  }, [
    activeSessionId,
    repoId,
    restartSandbox,
    sandboxRecord?.working_branch,
    sandboxRecordId,
  ]);

  const beginStoppedOverlayLaunchAttempt = useCallback(
    (
      nextSandboxRecordId: string | null = effectiveSandboxRecordId,
      nextRepoId: string | undefined = repoId
    ) => {
      const launchAttemptId = createSandboxLaunchAttemptId();
      setStoppedOverlayLaunchAttempt({
        repoId: nextRepoId,
        sandboxRecordId: nextSandboxRecordId,
        launchAttemptId,
      });
      return launchAttemptId;
    },
    [effectiveSandboxRecordId, repoId]
  );

  const clearStoppedOverlayLaunchAttempt = useCallback(
    (launchAttemptId: string | undefined) => {
      if (!launchAttemptId) return;
      setStoppedOverlayLaunchAttempt((current) =>
        current?.launchAttemptId === launchAttemptId ? null : current
      );
    },
    []
  );

  const handleOverlayLaunch = useCallback(
    (trigger: "status_overlay" | "empty_state") => {
      void (async () => {
        const currentActiveRepo = activeRepoRef.current;
        if (!currentActiveRepo) return;

        const currentSession = useSessionsStore.getState().getActiveSession();
        const currentSessionId = currentSession?.id ?? null;
        const currentSandboxRecordId = sandboxRecordIdRef.current;
        const currentRepoId = currentActiveRepo.id;
        const currentSandboxRecord = currentSandboxRecordId
          ? useSandboxStore.getState().getSandboxById(currentSandboxRecordId)
          : currentRepoId
            ? useSandboxStore.getState().getSandboxForRepo(currentRepoId)
            : null;
        const currentLiveProbe =
          deriveSandboxHealthStatus(currentSandboxRecord);
        const launchContext = resolvePreviewPaneLaunchContext({
          trigger,
          session: currentSession,
          record: currentSandboxRecord,
          sandboxRecordId: currentSandboxRecordId,
          liveProbe: currentLiveProbe,
        });
        const launchAttemptId =
          launchContext.shouldReserveStoppedOverlayLaunchAttempt
            ? beginStoppedOverlayLaunchAttempt(
                launchContext.effectiveSandboxRecordId,
                currentRepoId
              )
            : undefined;
        const outcome = await launchRepoSandbox(currentActiveRepo, {
          source: "preview_pane",
          trigger,
          intent: launchContext.intent,
          launchAttemptId,
          onConfirmed: launchAttemptId
            ? (request) => {
                bindSessionToPendingSandboxBranch(
                  currentSessionId,
                  request.workingBranch ?? null
                );
              }
            : undefined,
        });
        if (outcome.status === "launched") {
          clearStoppedOverlayLaunchAttempt(launchAttemptId);
          ensureSessionSandboxBinding(
            currentSessionId,
            launchContext.effectiveSandboxRecordId,
            outcome.sandbox.id
          );
        } else if (outcome.status === "cancelled") {
          clearStoppedOverlayLaunchAttempt(launchAttemptId);
        }
      })();
    },
    [
      beginStoppedOverlayLaunchAttempt,
      clearStoppedOverlayLaunchAttempt,
      launchRepoSandbox,
    ]
  );

  const handleStartFresh = useCallback(() => {
    const currentActiveRepo = activeRepoRef.current;
    if (!currentActiveRepo) return;

    void (async () => {
      const currentSession = useSessionsStore.getState().getActiveSession();
      const currentSessionId = currentSession?.id ?? null;
      const currentRepoId = currentActiveRepo.id;
      const currentSandboxRecordId =
        sandboxRecordIdRef.current ??
        useSandboxStore.getState().getSandboxForRepo(currentRepoId)?.id ??
        null;
      const launchAttemptId = beginStoppedOverlayLaunchAttempt(
        currentSandboxRecordId,
        currentRepoId
      );
      const outcome = await launchRepoSandbox(currentActiveRepo, {
        source: "preview_pane",
        trigger: "stopped_overlay_start_fresh",
        intent: { kind: "start_fresh" },
        launchAttemptId,
        onConfirmed: (request) => {
          bindSessionToPendingSandboxBranch(
            currentSessionId,
            request.workingBranch ?? null
          );
        },
      });
      if (outcome.status === "launched") {
        clearStoppedOverlayLaunchAttempt(launchAttemptId);
        ensureSessionSandboxBinding(
          currentSessionId,
          currentSandboxRecordId,
          outcome.sandbox.id
        );
      } else if (outcome.status === "cancelled") {
        clearStoppedOverlayLaunchAttempt(launchAttemptId);
      }
    })();
  }, [
    beginStoppedOverlayLaunchAttempt,
    clearStoppedOverlayLaunchAttempt,
    launchRepoSandbox,
  ]);

  const handleCapture = useCallback((region: SelectionRect) => {
    setCapturedRegion(region);
    setGrabMode(false);
  }, []);

  const handleCancelGrab = useCallback(() => {
    setGrabMode(false);
    setCapturedRegion(null);
  }, []);

  const handleFeedbackSubmit = useCallback(
    (text: string) => {
      if (!capturedRegion) return;
      const regionDesc = describeRegion(capturedRegion);
      trackActivation("preview_feedback_sent", {
        source: "preview_pane",
        region: regionDesc,
        width_pct: capturedRegion.width,
        height_pct: capturedRegion.height,
      });
      sendFeedback({
        id: crypto.randomUUID(),
        text: `[Preview feedback — ${regionDesc} (${capturedRegion.x}%,${capturedRegion.y}% ${capturedRegion.width}×${capturedRegion.height}%)]\n${text}`,
        region: capturedRegion,
        timestamp: Date.now(),
      });
      setCapturedRegion(null);
    },
    [capturedRegion, sendFeedback]
  );

  const handlePopOut = useCallback(() => {
    onPopOut?.(activeFile || undefined);
  }, [onPopOut, activeFile]);

  const handleTabChange = useCallback(
    (tab: Parameters<NonNullable<typeof onTabChange>>[0]) => {
      onTabChange?.(tab);
    },
    [onTabChange]
  );

  const handleOpenObservability = useCallback(() => {
    if (!activeRepo?.id) return;
    router.push(
      buildSandboxObservabilityHref({
        scope,
        repoId: activeRepo.id,
        sandboxRecordId: sandboxRecord?.id || sandboxRecordId,
      })
    );
  }, [activeRepo, router, sandboxRecord, sandboxRecordId, scope]);

  const handleReconcile = useCallback(async () => {
    if (!sandboxRecordId) return;
    await reconcileSandbox(sandboxRecordId);
    await reconcileHealth();
  }, [reconcileHealth, sandboxRecordId]);

  const handleToggleGrab = useCallback(() => {
    setGrabMode((prev) => !prev);
    setCapturedRegion(null);
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return {
    activeFile,
    activeTab,
    refreshKey,
    grabMode,
    capturedRegion,
    previewUrl,
    sandboxId,
    sandboxRecordId,
    sandboxRecord,
    sandboxError,
    sandboxUiState,
    overlayStatus,
    isRunning,
    isPaused,
    showOverlay,
    startingStale,
    launchLogs,
    repoId,
    activeRepo,
    activeSessionId,
    handlePause,
    handleStop,
    handleResume,
    handleRestart,
    handleOverlayLaunch,
    handleStartFresh,
    handleCapture,
    handleCancelGrab,
    handleFeedbackSubmit,
    handlePopOut,
    handleTabChange,
    handleOpenObservability,
    handleReconcile,
    handleToggleGrab,
    handleRefresh,
    reconcileHealth,
  };
}
