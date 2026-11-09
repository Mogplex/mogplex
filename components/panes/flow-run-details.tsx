"use client"

import { Dialog, DialogContent } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  getRunActionDescriptors,
  getRunActionEmptyState,
  type FlowRunAction,
} from "@/lib/flows/run-presentation"
import type { FlowRunDetail, FlowRunRecord } from "@/lib/types"

import { RunDetailsHeader, RunDetailsOverview } from "./flow-run-details/header-overview"
import {
  RunDetailsSummary,
  RunEditDiffsSection,
  RunReviewFindingsSection,
  RunWaitsSection,
} from "./flow-run-details/summary-sections"
import {
  RunAiCallsSection,
  RunDispatchTimelineSection,
  RunExecutionSection,
} from "./flow-run-details/timeline-sections"
import { RunActionButtons, type ActiveRunActions } from "./run-action-buttons"

type FlowRunDetailsDialogProps = {
  open: boolean
  runDetail: FlowRunDetail | null
  runSummary: FlowRunRecord | null
  loading: boolean
  error: unknown
  activeRunActions: ActiveRunActions
  reviewFindingIssueActionId: string | null
  onOpenChange: (open: boolean) => void
  onRunAction: (jobId: string, action: FlowRunAction) => void | Promise<void>
  onCreateReviewFindingIssue: (findingId: string) => void | Promise<void>
}

export function FlowRunDetailsDialog({
  open,
  runDetail,
  runSummary,
  loading,
  error,
  activeRunActions,
  reviewFindingIssueActionId,
  onOpenChange,
  onRunAction,
  onCreateReviewFindingIssue,
}: FlowRunDetailsDialogProps) {
  const actionRun = runDetail ?? runSummary

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flows-theme flex h-[92vh] max-h-[960px] !w-[96vw] !max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:!max-w-[1360px]"
        showCloseButton
      >
        <RunDetailsHeader runDetail={runDetail} runSummary={runSummary} />

        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading run details...</div>
        ) : error ? (
          <div className="p-6 text-sm text-accent-red">
            {error instanceof Error ? error.message : "Failed to load run details"}
          </div>
        ) : runDetail ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]">
            <ScrollArea className="min-h-0 border-b border-border bg-card/30 lg:border-r lg:border-b-0">
              <aside className="space-y-6 px-6 py-5">
                <section className="space-y-3">
                  <div className="text-sm font-medium text-foreground">Actions</div>
                  {actionRun && getRunActionDescriptors(actionRun).length > 0 ? (
                    <RunActionButtons
                      run={actionRun}
                      activeRunActions={activeRunActions}
                      onRunAction={onRunAction}
                      size="default"
                    />
                  ) : actionRun ? (
                    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      {getRunActionEmptyState(actionRun)}
                    </div>
                  ) : null}
                </section>

                <RunDetailsOverview runDetail={runDetail} />
              </aside>
            </ScrollArea>

            <ScrollArea className="min-h-0">
              <div className="space-y-6 px-6 py-5">
                <RunDetailsSummary runDetail={runDetail} />
                <RunWaitsSection runDetail={runDetail} />
                <RunEditDiffsSection runDetail={runDetail} />
                <RunReviewFindingsSection
                  runDetail={runDetail}
                  reviewFindingIssueActionId={reviewFindingIssueActionId}
                  onCreateReviewFindingIssue={onCreateReviewFindingIssue}
                />
                <RunDispatchTimelineSection runDetail={runDetail} />
                <RunExecutionSection runDetail={runDetail} />
                <RunAiCallsSection runDetail={runDetail} />
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="p-6 text-sm text-muted-foreground">Run details unavailable.</div>
        )}
      </DialogContent>
    </Dialog>
  )
}
