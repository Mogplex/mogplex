"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fetchJsonObject } from "@/lib/client-fetch";
import type { RunWorkspaceContext } from "@/lib/run-workspace/types";

export function RunCheckpointControls({ context, onRefresh }: {
  context: RunWorkspaceContext;
  onRefresh: () => unknown;
}) {
  const plan = context.checkpoint?.kind === "plan";
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [sending, setSending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit(action: "approve" | "revise") {
    if (inFlight.current || accepted || (action === "revise" && !feedback.trim())) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      await fetchJsonObject(`/api/runs/${context.runId}/checkpoint`, "Could not confirm your response. Try again.", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiCallId: context.aiCallId, action, ...(action === "revise" ? { feedback: feedback.trim() } : {}) }),
      });
      setAccepted(true);
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not confirm your response. Try again.");
      onRefresh();
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return <section aria-label={plan ? "Plan approval" : "Work review"} className="border-border space-y-2 border-t p-3 text-sm">
    <h2 className="font-medium">{plan ? "Plan ready for your approval" : "Ready for your review"}</h2>
    {context.checkpoint?.summary && <p className="text-muted-foreground max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs">{context.checkpoint.summary}</p>}
    {accepted ? <div role="status" className="text-muted-foreground text-xs">
      Response received. This run will continue in its saved workspace.
      <button type="button" className="ml-2 underline" onClick={() => onRefresh()}>Refresh status</button>
    </div> : <>
      <p className="text-muted-foreground text-xs">{plan ? "Approve to start the work, or request changes to the plan." : "Approve to open the pull request, or request changes."}</p>
      {revising ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); void submit("revise"); }}>
        <Textarea aria-label={plan ? "Plan feedback" : "Review feedback"} placeholder="What should change?" value={feedback} disabled={sending} onChange={event => setFeedback(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={sending || !feedback.trim()}>{sending ? "Sending…" : "Send feedback"}</Button>
          <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => setRevising(false)}>Cancel</Button>
        </div>
      </form> : <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={sending} onClick={() => void submit("approve")}>{sending ? "Submitting…" : plan ? "Approve plan" : "Ship it"}</Button>
        <Button variant="outline" size="sm" disabled={sending} onClick={() => setRevising(true)}>{plan ? "Revise plan" : "Request changes"}</Button>
      </div>}
      {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
    </>}
  </section>;
}
