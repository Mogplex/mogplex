"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle, NavArrowDown, Notes } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageResponse } from "@/components/ai-elements/message";
import { fetchJsonObject } from "@/lib/client-fetch";
import type { RunWorkspaceContext } from "@/lib/run-workspace/types";

export function RunCheckpointControls({ context, onRefresh }: {
  context: RunWorkspaceContext;
  onRefresh: () => unknown;
}) {
  const plan = context.checkpoint?.kind === "plan";
  const summaryId = useId();
  const feedbackId = useId();
  const [expanded, setExpanded] = useState(false);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [sending, setSending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const feedbackInput = useRef<HTMLTextAreaElement>(null);
  const reviseButton = useRef<HTMLButtonElement>(null);
  const wasRevising = useRef(false);
  useEffect(() => {
    if (revising) feedbackInput.current?.focus();
    else if (wasRevising.current) reviseButton.current?.focus();
    wasRevising.current = revising;
  }, [revising]);

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

  return <section aria-label={plan ? "Plan approval" : "Work review"} className="border-border bg-card m-3 shrink-0 overflow-hidden rounded-lg border text-sm">
    <div className="flex items-start gap-3 px-4 pt-4">
      <div className="bg-primary/10 text-primary mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md" aria-hidden="true"><Notes className="size-4" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground mb-1 text-xs font-medium">{accepted ? "Response sent" : "Awaiting your approval"}</p>
        <h2 className="text-foreground font-semibold">{plan ? "Review the plan" : "Review the changes"}</h2>
      </div>
    </div>
    {context.checkpoint?.summary && <div className="px-4">
      <button type="button" className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-h-11 w-full items-center justify-between gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:outline-none" aria-expanded={expanded} aria-controls={summaryId} onClick={() => setExpanded(value => !value)}>
        {plan ? "Plan summary" : "Review summary"}<NavArrowDown aria-hidden="true" className={`size-4 shrink-0 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
      </button>
      <div id={summaryId} hidden={!expanded} className="border-border mb-3 max-h-[min(40vh,20rem)] overflow-auto overscroll-contain border-t pt-3 pr-2">
        {expanded && <MessageResponse className="text-foreground text-sm leading-6 break-words">{context.checkpoint.summary}</MessageResponse>}
      </div>
    </div>}
    {accepted ? <div role="status" className="space-y-2 px-4 pb-4 pt-2">
      <p className="flex items-center gap-2 font-medium"><CheckCircle aria-hidden="true" className="text-accent-green size-4" />Response received</p>
      <p className="text-muted-foreground">This run will continue in its saved workspace.</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => onRefresh()}>Refresh status</Button>
    </div> : <>
      <div className="space-y-3 px-4 pb-4 pt-2">
      <p className="text-muted-foreground leading-5">{plan ? "Approving starts implementation. You can revise the plan first." : "Approving opens the pull request. You can request changes first."}</p>
      {revising ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit("revise"); }}>
        <label htmlFor={feedbackId} className="block font-medium">{plan ? "What should change in the plan?" : "What should change?"}</label>
        <Textarea ref={feedbackInput} id={feedbackId} aria-label={plan ? "Plan feedback" : "Review feedback"} className="min-h-24" placeholder="Describe the changes you want…" value={feedback} disabled={sending} onChange={event => setFeedback(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="min-h-11" disabled={sending || !feedback.trim()}>{sending ? "Sending…" : "Send feedback"}</Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={sending} onClick={() => setRevising(false)}>Cancel</Button>
        </div>
      </form> : <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" disabled={sending} onClick={() => void submit("approve")}>{sending ? "Submitting…" : plan ? "Approve plan" : "Ship it"}</Button>
        <Button ref={reviseButton} variant="outline" className="min-h-11" disabled={sending} onClick={() => setRevising(true)}>{plan ? "Revise plan" : "Request changes"}</Button>
      </div>}
      {error && <p role="alert" className="text-destructive leading-5">{error}</p>}
      </div>
    </>}
  </section>;
}
