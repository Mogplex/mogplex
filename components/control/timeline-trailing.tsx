"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import type { UIMessage } from "ai";
import { ChangedFilesBar } from "@/components/sandbox-changes/changed-files-bar";
import { collectChangedFiles } from "@/lib/control/changed-files";
import { lastUserMessageText } from "@/lib/agents/ui-message-text";
import { ChangedFilesCard } from "./changed-files-card";
import { MissionExecutionStatus } from "./coordinator-followup";
import type { useControlWorkers } from "./use-control-workers";

type ControlWorkersState = ReturnType<typeof useControlWorkers>;

/**
 * Content rendered under the Control timeline: the live working tree of the
 * selected sandbox (diff, revert, commit, pull request), the transcript-derived
 * change summary for sessions without a running sandbox, and worker status.
 */
export function TimelineTrailing({
  messages,
  chatPending,
  sandboxId,
  sessionId,
  workers,
}: {
  messages: UIMessage[];
  chatPending: boolean;
  /** Running sandbox bound to the session, if any. */
  sandboxId: string | null;
  sessionId: string | null;
  workers: ControlWorkersState;
}) {
  const [refreshToken, bumpRefresh] = useReducer(
    (count: number) => count + 1,
    0
  );
  const wasPending = useRef(chatPending);
  useEffect(() => {
    if (wasPending.current && !chatPending) bumpRefresh();
    wasPending.current = chatPending;
  }, [chatPending]);

  const hasTranscriptChanges = useMemo(
    () => collectChangedFiles(messages).length > 0,
    [messages]
  );
  const defaultCommitMessage = useMemo(
    () => lastUserMessageText(messages).split("\n")[0]?.slice(0, 72) ?? "",
    [messages]
  );

  return (
    <>
      {sandboxId ? (
        <ChangedFilesBar
          sandboxId={sandboxId}
          disabled={chatPending}
          refreshToken={refreshToken}
          defaultCommitMessage={defaultCommitMessage}
        />
      ) : (
        !chatPending &&
        hasTranscriptChanges && <ChangedFilesCard messages={messages} />
      )}
      <MissionExecutionStatus
        compact={chatPending}
        sessionId={sessionId}
        workers={workers.workers}
        error={workers.error}
        loading={workers.loading}
        onRefresh={workers.refresh}
      />
    </>
  );
}
