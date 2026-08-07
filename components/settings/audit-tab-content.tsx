"use client";

import { formatTeamAuditPayload } from "@/lib/team-audit-presentation";
import { formatDateTime, formatAuditAction } from "./team-settings-helpers";
import type { TeamAuditEventsResponse } from "@/app/api/teams/[teamId]/audit-events/route";

type AuditTabContentProps = {
  auditData: TeamAuditEventsResponse | undefined;
  auditError: Error | undefined;
};

export function AuditTabContent({
  auditData,
  auditError,
}: AuditTabContentProps) {
  return (
    <section className="border border-border/60 bg-card">
      <div className="px-5 pt-5 pb-2">
        <div className="ui-section-title">Audit Log</div>
        <div className="ui-section-caption">Team administration and denied-action events.</div>
      </div>
      <div className="divide-y divide-border">
        {auditError && (
          <div className="p-4 text-sm text-destructive">Unable to load audit events.</div>
        )}
        {(auditData?.events ?? []).length === 0 && !auditError && (
          <div className="p-4 text-sm text-muted-foreground">No audit events yet.</div>
        )}
        {(auditData?.events ?? []).map((event) => {
          const payloadSummary = formatTeamAuditPayload(event.payload);
          return (
            <div key={event.id} className="grid gap-2 p-3 md:grid-cols-[180px_1fr_140px] md:items-start">
              <div className="text-[12px] text-muted-foreground">
                {formatDateTime(event.createdAt)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {formatAuditAction(event.action)}
                </div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  {event.targetType}
                  {event.targetId ? ` · ${event.targetId}` : ""}
                </div>
                {payloadSummary && (
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {payloadSummary}
                  </div>
                )}
              </div>
              {event.decisionCode ? (
                <span className="w-fit rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
                  {event.decisionCode.replace(/_/g, " ")}
                </span>
              ) : (
                <span className="w-fit rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
                  recorded
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
