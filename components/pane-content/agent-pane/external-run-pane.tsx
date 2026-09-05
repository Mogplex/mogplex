"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useConversationsStore } from "@/hooks/use-conversations";
import { useSessionsStore } from "@/hooks/use-sessions";
import { useUser } from "@/hooks/use-user";
import type { PaneNode } from "@/hooks/use-split-panes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { scopedHref } from "@/lib/scoped-href";
import { isRunActive } from "@/lib/run-workspace/types";
import { projectRunTranscript } from "@/lib/run-workspace/transcript";
import { ChatMessageList } from "./chat-message-list";
import { useExternalRun } from "./use-external-run";

export function ExternalRunPane({ pane, onStreamingChange, onUpdatePane }: {
  pane: PaneNode & { externalRunId: string };
  onStreamingChange: (value: boolean) => void;
  onUpdatePane?: (updates: Partial<PaneNode>) => void;
}) {
  const { scope } = useParams<{ scope: string }>();
  const { user } = useUser();
  const { context, events, status, connection, error, reload } = useExternalRun(pane.externalRunId);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const submission = useRef<{ id: string; text: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const running = isRunActive(status);
  const messages = useMemo(() => [...projectRunTranscript(pane.externalRunId, context?.prompt ?? "Loading request…", events, status),
    ...(context?.guidance ?? []).map(item => ({ id: item.id, role: "user" as const, parts: [{ type: "text" as const, text: `${item.body}\n(${item.status === "received" ? "Saved for the next agent step" : item.status === "delivered" ? "Delivered to agent" : "Not applied before the run stopped"})` }] }))], [context?.prompt, context?.guidance, events, pane.externalRunId, status]);
  useEffect(() => { onStreamingChange(running); return () => onStreamingChange(false); }, [running, onStreamingChange]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [events]);

  async function sendGuidance() {
    if (!text.trim() || sending) return;
    setSending(true);
    if (submission.current?.text !== text.trim()) submission.current = { id: crypto.randomUUID(), text: text.trim() };
    try {
      const response = await fetch(`/api/runs/${pane.externalRunId}/guidance`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission.current),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not save guidance");
      setReceipt(data.status === "not_applied" ? "The run finished before this message could be applied." : data.status === "delivered" ? "Guidance delivered to the agent." : "Guidance saved. The agent will receive it at its next step.");
      setText("");
      submission.current = null;
      void reload();
    } catch (cause) { setReceipt(cause instanceof Error ? cause.message : "Could not save guidance"); }
    finally { setSending(false); }
  }

  async function continueChat() {
    if (!context || !user || sending) return;
    setSending(true);
    const store = useConversationsStore.getState();
    store.setUserId(user.id);
    const session = useSessionsStore.getState().sessions.find(item => item.externalRunId === pane.externalRunId);
    const id = crypto.randomUUID();
    store.startConversation(pane.id, { id, repoId: context.repo.id, sandboxId: context.sandboxRecordId, workspaceSessionId: session?.id ?? null });
    // Tool telemetry is not a model transcript. Preserve its readable summary
    // without inventing tool inputs/results for the next agent turn.
    store.setMessages(pane.id, messages.map(message => ({ ...message, parts: message.parts.flatMap(part =>
      part.type === "text" ? [part] : part.type === "dynamic-tool" ? [{ type: "text" as const, text: `\n${part.toolName}: ${part.state}\n` }] : []
    ) })));
    if (await store.syncToSupabase(pane.id)) onUpdatePane?.({ externalRunId: undefined, conversationId: id });
    else setReceipt("Could not save the conversation. Try again.");
    setSending(false);
  }

  return <>
    <div className="border-border flex items-center gap-2 border-b px-2 py-1.5 text-xs">
      <span role="status">{status === "success" ? "Run complete" : status === "failed" ? "Run failed" : status === "cancelled" ? "Run cancelled" : status === "awaiting_input" ? "Waiting for input" : "Agent is working"}</span>
      <span className="text-muted-foreground">{connection}</span>
      <a className="ml-auto underline" href={scopedHref(scope, `/runs/${pane.externalRunId}?view=details`)}>Run details</a>
    </div>
    <ChatMessageList messages={messages} localMsgs={[]} liveConversationRuns={[]} activeCallEvents={[]} isAgentRunning={running} endRef={endRef} />
    {error && <div role="alert" className="px-2 py-1 text-accent-red">{error}</div>}
    {receipt && <div role="status" className="px-2 py-1 text-xs">{receipt}</div>}
    {running && context?.canGuide ? <form className="border-border space-y-2 border-t p-2" onSubmit={event => { event.preventDefault(); void sendGuidance(); }}>
      <Textarea aria-label="Guide this run" placeholder="Add guidance for this run…" value={text} onChange={event => setText(event.target.value)} />
      <Button type="submit" size="sm" disabled={sending || !text.trim()}>{sending ? "Sending…" : "Send guidance"}</Button>
    </form> : !running && status !== "awaiting_input" && context ? <div className="border-border border-t p-2">
      <Button size="sm" onClick={() => void continueChat()} disabled={sending || !user}>Continue in workspace chat</Button>
    </div> : <p className="text-muted-foreground p-2 text-xs">{status === "awaiting_input" ? "Open run details to review the checkpoint." : "Watching this run. Open run details for controls."}</p>}
  </>;
}
