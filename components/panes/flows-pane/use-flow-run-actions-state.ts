import { useRef, useState } from "react";
import type { ActiveRunActions } from "../flow-run-details";

export type FlowRunActionsState = {
  // Run actions (requeue, repair, cancel)
  activeRunActionsRef: React.MutableRefObject<ActiveRunActions>;
  activeRunActions: ActiveRunActions;
  setActiveRunActions: (actions: ActiveRunActions) => void;
  // Review finding issue creation
  reviewFindingIssueActionId: string | null;
  setReviewFindingIssueActionId: (id: string | null) => void;
};

/**
 * Manages state for flow run actions (requeue, repair, cancel)
 * and review finding issue creation.
 */
export function useFlowRunActionsState(): FlowRunActionsState {
  // Ref prevents async double-fires before React flushes state; state drives disabled UI.
  const activeRunActionsRef = useRef<ActiveRunActions>({});
  const [activeRunActions, setActiveRunActions] = useState<ActiveRunActions>(
    {}
  );
  const [reviewFindingIssueActionId, setReviewFindingIssueActionId] = useState<
    string | null
  >(null);

  return {
    activeRunActionsRef,
    activeRunActions,
    setActiveRunActions,
    reviewFindingIssueActionId,
    setReviewFindingIssueActionId,
  };
}
