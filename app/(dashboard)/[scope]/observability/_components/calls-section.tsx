"use client";

import { type ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import type { CallsFilters } from "@/hooks/use-observability";
import type { AiCall } from "@/lib/types";
import { useMemo } from "react";
import { StatusBadge } from "./badges";
import { CallExpandedRow } from "./call-expanded-row";
import { CallsControls } from "./calls-controls";
import {
  CALL_TYPE_LABELS,
  formatDuration,
  formatTokens,
  timeAgo,
} from "./formatters";
import { PaginationControls } from "./pagination-controls";

function readSlackAttributionMode(metadata: Record<string, unknown>) {
  const value = metadata.slack_attribution_mode;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function CallsSection({
  calls,
  callsLoading,
  callsPages,
  callsTotal,
  callFilters,
  filteredRepoLabel,
  selectedCallId,
  expandedCallRowIds,
  onUpdateCallFilter,
  onClearRepoCallFilter,
  onClearSandboxCallFilter,
  onClearSelectedCallId,
  onCopySelectedCallLink,
  onExpandedRowToggle,
  onOpenSandboxHealth,
  canOpenSandboxHealth,
}: {
  calls: AiCall[];
  callsLoading: boolean;
  callsPages: number;
  callsTotal: number;
  callFilters: CallsFilters;
  filteredRepoLabel?: string | null;
  selectedCallId?: string;
  expandedCallRowIds: string[];
  onUpdateCallFilter: (
    key: keyof CallsFilters,
    value: CallsFilters[keyof CallsFilters]
  ) => void;
  onClearRepoCallFilter: () => void;
  onClearSandboxCallFilter: () => void;
  onClearSelectedCallId: () => void;
  onCopySelectedCallLink: () => Promise<boolean>;
  onExpandedRowToggle: (call: AiCall, expanded: boolean) => void;
  onOpenSandboxHealth: (call: AiCall) => void;
  canOpenSandboxHealth: (call: AiCall) => boolean;
}) {
  const callColumns = useMemo<ColumnDef<AiCall, unknown>[]>(
    () => [
      {
        accessorKey: "started_at",
        header: "Time",
        cell: ({ row }) => (
          <span title={row.original.started_at}>
            {timeAgo(row.original.started_at)}
          </span>
        ),
      },
      {
        accessorKey: "type",
        header: "Type",
        cell: ({ row }) => {
          const slackAttributionMode = readSlackAttributionMode(
            row.original.metadata
          );
          return (
            <div className="flex flex-wrap items-center gap-1">
              <Badge variant="outline" className="text-[11px]">
                {CALL_TYPE_LABELS[row.original.type] || row.original.type}
              </Badge>
              {slackAttributionMode && (
                <Badge
                  variant={
                    slackAttributionMode === "installer_fallback"
                      ? "destructive"
                      : "secondary"
                  }
                  className="text-[11px]"
                >
                  {slackAttributionMode === "installer_fallback"
                    ? "Slack fallback"
                    : "Slack"}
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "model",
        header: "Model",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.model.split("/").pop()}
          </span>
        ),
      },
      {
        accessorKey: "total_tokens",
        header: "Tokens",
        cell: ({ row }) => formatTokens(row.original.total_tokens),
      },
      {
        accessorKey: "duration_ms",
        header: "Duration",
        cell: ({ row }) => formatDuration(row.original.duration_ms),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    []
  );

  return (
    <section className="space-y-3">
      <CallsControls
        callsLoading={callsLoading}
        callFilters={callFilters}
        filteredRepoLabel={filteredRepoLabel}
        selectedCallId={selectedCallId}
        onUpdateCallFilter={onUpdateCallFilter}
        onClearRepoCallFilter={onClearRepoCallFilter}
        onClearSandboxCallFilter={onClearSandboxCallFilter}
        onClearSelectedCallId={onClearSelectedCallId}
        onCopySelectedCallLink={onCopySelectedCallLink}
      />

      <div className="border-border overflow-hidden rounded-md border">
        <DataTable
          columns={callColumns}
          data={calls}
          getRowId={(call) => call.id}
          expandedRowIds={expandedCallRowIds}
          onExpandedRowToggle={onExpandedRowToggle}
          renderExpandedRow={(call) => (
            <CallExpandedRow
              call={call}
              canOpenSandboxHealth={canOpenSandboxHealth(call)}
              onOpenSandboxHealth={onOpenSandboxHealth}
            />
          )}
        />
      </div>
      <PaginationControls
        page={callFilters.page}
        totalPages={callsPages}
        total={callsTotal}
        limit={callFilters.limit}
        onChange={(page) => onUpdateCallFilter("page", page)}
      />
    </section>
  );
}
