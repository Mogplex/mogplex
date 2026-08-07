import type React from "react";
import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import type { Flow, FlowRunDetail, FlowRunRecord } from "@/lib/types";
import type { FlowTab } from "./types";
import { readFlowTabFromLocation } from "./canvas-utils";

const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `API error: ${response.status}`);
  }
  return response.json();
};

export type FlowSelectionState = {
  // Flow selection
  selectedFlowId: string | null;
  setSelectedFlowId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedFlow: Flow | undefined;
  mutateSelectedFlow: () => Promise<Flow | undefined>;
  // Run selection
  selectedRunId: string | null;
  setSelectedRunId: React.Dispatch<React.SetStateAction<string | null>>;
  flowRunsResponse: { runs: FlowRunRecord[] } | undefined;
  mutateFlowRuns: () => Promise<{ runs: FlowRunRecord[] } | undefined>;
  // Run detail
  selectedRunDetailResponse: { run: FlowRunDetail } | undefined;
  selectedRunDetailError: Error | undefined;
  selectedRunDetailLoading: boolean;
  mutateSelectedRunDetail: () => Promise<{ run: FlowRunDetail } | undefined>;
  // Active tab
  activeFlowTab: FlowTab;
  setActiveFlowTab: (value: string) => void;
};

/**
 * Manages the selection state for flows, runs, and the active tab.
 * Includes SWR data fetching for the selected flow and run details.
 */
export function useFlowSelectionState(): FlowSelectionState {
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const { data: selectedFlow, mutate: mutateSelectedFlow } = useSWR<Flow>(
    selectedFlowId ? `/api/flows/${selectedFlowId}` : null,
    fetcher
  );
  const { data: flowRunsResponse, mutate: mutateFlowRuns } = useSWR<{
    runs: FlowRunRecord[];
  }>(
    selectedFlowId ? `/api/flows/${selectedFlowId}/runs?limit=12` : null,
    fetcher
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeFlowTab, setActiveFlowTabState] = useState<FlowTab>(
    readFlowTabFromLocation
  );

  // Sync tab state from browser back/forward navigation
  useEffect(() => {
    const syncFlowTabFromLocation = () =>
      setActiveFlowTabState(readFlowTabFromLocation());
    window.addEventListener("popstate", syncFlowTabFromLocation);
    return () =>
      window.removeEventListener("popstate", syncFlowTabFromLocation);
  }, []);

  // Update URL when tab changes
  const setActiveFlowTab = useCallback((value: string) => {
    const nextTab: FlowTab = value === "runs" ? "runs" : "editor";
    const url = new URL(window.location.href);
    const currentUrlTab: FlowTab =
      url.searchParams.get("tab") === "runs" ? "runs" : "editor";

    if (nextTab !== currentUrlTab) {
      if (nextTab === "runs") {
        url.searchParams.set("tab", "runs");
      } else {
        url.searchParams.delete("tab");
      }

      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`
      );
    }

    setActiveFlowTabState((current) =>
      current === nextTab ? current : nextTab
    );
  }, []);

  const {
    data: selectedRunDetailResponse,
    error: selectedRunDetailError,
    isLoading: selectedRunDetailLoading,
    mutate: mutateSelectedRunDetail,
  } = useSWR<{ run: FlowRunDetail }>(
    selectedFlowId && selectedRunId
      ? `/api/flows/${selectedFlowId}/runs/${selectedRunId}`
      : null,
    fetcher
  );

  // Clear selected run when flow changes
  useEffect(() => {
    setSelectedRunId(null);
  }, [selectedFlowId]);

  return {
    selectedFlowId,
    setSelectedFlowId,
    selectedFlow,
    mutateSelectedFlow,
    selectedRunId,
    setSelectedRunId,
    flowRunsResponse,
    mutateFlowRuns,
    selectedRunDetailResponse,
    selectedRunDetailError,
    selectedRunDetailLoading,
    mutateSelectedRunDetail,
    activeFlowTab,
    setActiveFlowTab,
  };
}
