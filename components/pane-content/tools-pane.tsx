"use client";
import { useLiveInteractiveCalls, useAiCallEvents } from "@/hooks/use-observability";
import { StructuredValueViewer } from "@/components/diffs/structured-value-viewer";
import { timeAgo } from "./utils";

export function ToolsPane() {
  const { calls } = useLiveInteractiveCalls();
  const activeCall = calls[0] || null;
  const { events } = useAiCallEvents(activeCall?.id || null);
  return (
    <div className="flex-1 space-y-1 overflow-auto p-2">
      {!activeCall && (
        <div className="text-muted-foreground">No active interactive runs</div>
      )}
      {activeCall && (
        <div className="border-border rounded-md border">
          <div className="bg-secondary flex items-center gap-2 rounded-t-md px-2 py-1.5">
            <span className="text-accent-blue">{activeCall.type}</span>
            <span className="text-muted-foreground text-[11px]">
              {activeCall.model}
            </span>
            <span className="text-muted-foreground ml-auto text-[11px]">
              {timeAgo(activeCall.started_at)}
            </span>
          </div>
          <div className="space-y-2 p-2 text-[11px]">
            {events.length === 0 && (
              <div className="text-muted-foreground">
                Waiting for run events...
              </div>
            )}
            {events.map((event) => (
              <div
                key={event.id}
                className="border-border-dim space-y-1 rounded border px-2 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-secondary-foreground">
                    {event.event_type.replaceAll("_", " ")}
                  </span>
                  {event.tool_name && (
                    <span className="text-accent-blue">{event.tool_name}</span>
                  )}
                  <span className="text-muted-foreground ml-auto">
                    {timeAgo(event.created_at)}
                  </span>
                </div>
                {event.message && (
                  <div className="text-muted-foreground">{event.message}</div>
                )}
                {event.payload && Object.keys(event.payload).length > 0 && (
                  <StructuredValueViewer
                    value={event.payload}
                    className="my-0"
                    stringLanguage="language-json"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
