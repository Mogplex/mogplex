import { useCallback, type RefObject } from "react";
import { toast } from "@/hooks/use-toast";
import type { Flow, FlowRunDetail, FlowRunRecord } from "@/lib/types";
import type { FlowRunAction } from "@/lib/flows/run-presentation";
import type { ActiveRunActions } from "../flow-run-details";

export type FlowRunHandlersDeps = {
  // Run actions state
  activeRunActionsRef: RefObject<ActiveRunActions>;
  setActiveRunActions: (actions: ActiveRunActions) => void;
  reviewFindingIssueActionId: string | null;
  setReviewFindingIssueActionId: (id: string | null) => void;
  // Run detail
  selectedRunDetail: FlowRunDetail | null;
  // Mutators
  mutateFlowRuns: () => Promise<{ runs: FlowRunRecord[] } | undefined>;
  mutateFlows: () => Promise<Flow[] | undefined>;
  mutateSelectedRunDetail: () => Promise<{ run: FlowRunDetail } | undefined>;
};

export type FlowRunHandlers = {
  setRunActionState: (jobId: string, action: FlowRunAction | null) => void;
  runFlowJobAction: (jobId: string, action: FlowRunAction) => Promise<void>;
  createReviewFindingIssue: (findingId: string) => Promise<void>;
};

/**
 * Handlers for run tab actions: cancel, requeue, repair, and review finding issues.
 */
export function useFlowRunHandlers(deps: FlowRunHandlersDeps): FlowRunHandlers {
  const {
    activeRunActionsRef,
    setActiveRunActions,
    reviewFindingIssueActionId,
    setReviewFindingIssueActionId,
    selectedRunDetail,
    mutateFlowRuns,
    mutateFlows,
    mutateSelectedRunDetail,
  } = deps;

  const setRunActionState = useCallback(
    (jobId: string, action: FlowRunAction | null) => {
      const next = { ...activeRunActionsRef.current };

      if (action) {
        next[jobId] = action;
      } else {
        delete next[jobId];
      }

      (
        activeRunActionsRef as React.MutableRefObject<ActiveRunActions>
      ).current = next;
      setActiveRunActions(next);
    },
    [activeRunActionsRef, setActiveRunActions]
  );

  const runFlowJobAction = useCallback(
    async (jobId: string, action: FlowRunAction) => {
      if (activeRunActionsRef.current?.[jobId]) return;

      setRunActionState(jobId, action);

      try {
        const response = await fetch(
          `/api/observability/jobs/${jobId}/${action}`,
          { method: "POST" }
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || `Failed to ${action} flow run`);
        }
        await Promise.all([
          mutateFlowRuns(),
          mutateFlows(),
          mutateSelectedRunDetail(),
        ]);
        toast({
          title:
            action === "repair"
              ? "Repair queued"
              : action === "requeue"
                ? "Retry queued"
                : "Run cancelled",
          description:
            action === "cancel"
              ? payload.cancelError
                ? `Cancellation completed with warnings: ${payload.cancelError}`
                : "Run cancelled."
              : payload.jobRunId
                ? `Job ${payload.jobRunId} queued.`
                : undefined,
        });
      } catch (error) {
        toast({
          title:
            action === "repair"
              ? "Repair failed"
              : action === "requeue"
                ? "Retry failed"
                : "Cancel failed",
          description:
            error instanceof Error
              ? error.message
              : `Failed to ${action} flow run`,
          variant: "destructive",
        });
      } finally {
        setRunActionState(jobId, null);
      }
    },
    [
      activeRunActionsRef,
      mutateFlowRuns,
      mutateFlows,
      mutateSelectedRunDetail,
      setRunActionState,
    ]
  );

  const createReviewFindingIssue = useCallback(
    async (findingId: string) => {
      if (reviewFindingIssueActionId) return;
      if (!selectedRunDetail) {
        toast({
          title: "No run selected",
          description: "Reload the run details and try again.",
          variant: "destructive",
        });
        return;
      }

      setReviewFindingIssueActionId(findingId);

      try {
        const response = await fetch(
          `/api/observability/jobs/${selectedRunDetail.id}/review-findings/${findingId}/issue`,
          { method: "POST" }
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to create GitHub issue");
        }

        await mutateSelectedRunDetail();

        toast({
          title:
            payload?.created === false
              ? "Issue already linked"
              : "Issue created",
          description:
            typeof payload?.issueNumber === "number"
              ? `GitHub issue #${payload.issueNumber}`
              : undefined,
        });
      } catch (error) {
        toast({
          title: "Issue creation failed",
          description:
            error instanceof Error
              ? error.message
              : "Failed to create GitHub issue",
          variant: "destructive",
        });
      } finally {
        setReviewFindingIssueActionId(null);
      }
    },
    [
      mutateSelectedRunDetail,
      reviewFindingIssueActionId,
      selectedRunDetail,
      setReviewFindingIssueActionId,
    ]
  );

  return {
    setRunActionState,
    runFlowJobAction,
    createReviewFindingIssue,
  };
}
