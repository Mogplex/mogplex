"use client";

import { useState, type ComponentProps } from "react";
import { MissionWorkers } from "./mission-workers";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import { presentControlContinuation, type ControlContinuationSummary } from "@/lib/control/continuation-presentation";

const SPECS = [{table:"control_continuations",filter:"user_id=eq.$USER_ID"}];
export function MissionExecutionStatus({sessionId,...workers}:{sessionId:string|null}&ComponentProps<typeof MissionWorkers>) {
  return <><MissionWorkers {...workers} /><CoordinatorFollowup key={sessionId} sessionId={sessionId} /></>;
}
async function fetchFollowups(url:string):Promise<{continuations:ControlContinuationSummary[]}> {
  const response = await fetch(url);
  if(!response.ok) throw new Error("Could not load coordinator follow-ups.");
  return response.json();
}

export function CoordinatorFollowup({sessionId}:{sessionId:string|null}) {
  const {data,error,mutate} = useSWR(sessionId ? `/api/control/continuations?sessionId=${encodeURIComponent(sessionId)}` : null,fetchFollowups,{refreshInterval:0,shouldRetryOnError:false});
  const [pending,setPending] = useState<string|null>(null);
  const [actionError,setActionError] = useState<string|null>(null);
  const [connection,setConnection] = useState<"connecting"|"connected"|"disconnected">("connecting");
  useRealtimeRouteRefresh({channelName:"control-followups",specs:SPECS,enabled:Boolean(sessionId),onInvalidate:mutate,onConnectionChange:setConnection});
  const tickets = data?.continuations ?? [];
  const active = tickets.filter((ticket) => ["waiting","ready","running"].includes(ticket.status));
  const visible = active.length ? active : tickets.slice(0,1);
  const act = async (id:string,action:"cancel"|"retry_delivery") => {
    setPending(id);setActionError(null);
    try {
      const response = await fetch("/api/control/continuations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,action})});
      if(!response.ok) throw new Error("Could not update the follow-up. Refresh its status before trying again.");
      await mutate();
    } catch(e) {setActionError(e instanceof Error ? e.message : "Could not update the follow-up.");}
    finally {setPending(null);}
  };
  if(!visible.length && !error && !actionError) return null;
  return <section aria-label="Coordinator follow-up" className="border-border mt-4 min-w-0 border-t py-4">
    {visible.map((ticket) => {
      const view = presentControlContinuation(ticket);
      return <div key={ticket.id} className="flex flex-col gap-3 py-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 max-w-prose">
          <p role="status" className="text-foreground text-sm font-medium">{view.label}</p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{view.description}</p>
        </div>
        {(view.cancelable || view.retryable) && <div className="flex shrink-0 flex-wrap gap-2">
          {view.retryable && <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => void act(ticket.id,"retry_delivery")}>{pending === ticket.id ? "Updating…" : "Retry follow-up"}</Button>}
          {view.cancelable && <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => void act(ticket.id,"cancel")}>Stop follow-up</Button>}
        </div>}
      </div>;
    })}
    {(error || actionError || connection === "disconnected") && <div role="alert" className="text-destructive mt-2 text-xs">
      <p>{actionError ?? (error ? "Could not load coordinator follow-ups. Displayed status may be out of date." : "Live updates disconnected. Displayed status may be out of date.")}</p>
      <Button size="sm" variant="outline" className="mt-2" onClick={() => void mutate()}>Refresh follow-up</Button>
    </div>}
  </section>;
}
