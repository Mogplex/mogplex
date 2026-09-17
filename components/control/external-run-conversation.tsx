"use client";
import { useParams } from "next/navigation";
import { ExternalRunPane } from "@/components/pane-content/agent-pane/external-run-pane";
import type { ControlSessionSummary } from "@/lib/control/session-types";
import { scopedHref } from "@/lib/scoped-href";

const reportStreaming = () => {};

/** Show the original durable run; selecting a Slack conversation never launches work. */
export function ExternalRunConversation({ session }: {
  session: ControlSessionSummary & { external_run_id: string };
}) {
  const { scope } = useParams<{ scope: string }>();
  const workspaceHref = scopedHref(scope, `/projects/workspace?run=${session.external_run_id}`);
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="control-external-run">
    <header className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm">
      <span className="text-muted-foreground">{session.project}</span>
      <h1 className="min-w-0 flex-1 truncate font-medium">{session.title}</h1>
      <a href={workspaceHref} className="shrink-0 underline">Open workspace</a>
    </header>
    <ExternalRunPane
      key={session.external_run_id}
      pane={{
        id: `control-${session.id}`, externalRunId: session.external_run_id,
        type: "agent", name: session.title, lines: [], status: "idle",
      }}
      onStreamingChange={reportStreaming}
      workspaceHref={workspaceHref}
    />
  </div>;
}
