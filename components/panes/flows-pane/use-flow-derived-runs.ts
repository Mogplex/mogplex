import { useMemo } from "react";
import {
  flowRunStatusLabel,
  type FlowRunStatusLabel,
} from "@/lib/flows/run-presentation";
import type { FlowRunRecord } from "@/lib/types";

export interface FlowDerivedRunsParams {
  flowRunsResponse: { runs: FlowRunRecord[] } | undefined;
  selectedRunId: string | null;
}

export interface FlowDerivedRunsResult {
  flowRuns: FlowRunRecord[];
  latestFlowRun: FlowRunRecord | null;
  latestFlowRunStatus: FlowRunStatusLabel | null;
  selectedRunSummary: FlowRunRecord | null;
  flowSuccessRateLabel: string | null;
}

export function useFlowDerivedRuns(
  params: FlowDerivedRunsParams
): FlowDerivedRunsResult {
  const { flowRunsResponse, selectedRunId } = params;

  const flowRuns = useMemo(
    () => flowRunsResponse?.runs ?? [],
    [flowRunsResponse?.runs]
  );

  const latestFlowRun = useMemo(() => flowRuns[0] ?? null, [flowRuns]);

  const latestFlowRunStatus = latestFlowRun
    ? flowRunStatusLabel(latestFlowRun)
    : null;

  const selectedRunSummary = useMemo(
    () =>
      flowRuns.find((run: FlowRunRecord) => run.id === selectedRunId) || null,
    [flowRuns, selectedRunId]
  );

  const flowSuccessRateLabel = useMemo(() => {
    if (flowRuns.length === 0) return null;
    const completedRuns = flowRuns.filter(
      (run: FlowRunRecord) =>
        run.status === "success" || run.status === "failed"
    );
    if (completedRuns.length === 0) return null;
    const successfulRuns = completedRuns.filter(
      (run: FlowRunRecord) => run.status === "success"
    ).length;
    return `${Math.round((successfulRuns / completedRuns.length) * 100)}%`;
  }, [flowRuns]);

  return {
    flowRuns,
    latestFlowRun,
    latestFlowRunStatus,
    selectedRunSummary,
    flowSuccessRateLabel,
  };
}
