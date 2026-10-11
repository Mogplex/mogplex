"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { UIMessage } from "ai";
import type { SandboxRecord } from "@/lib/types";
import {
  latestTaskSandbox,
  resolveTaskSandbox,
  type TaskSandboxSelection,
} from "@/lib/control/task-sandbox";

export function useTaskSandbox(
  sessionId: string | null,
  sandboxes: SandboxRecord[],
  messages: UIMessage[]
) {
  const { scope } = useParams<{ scope: string }>();
  const storageKey = `mogplex.control.sandbox.${scope}.${sessionId}`;
  const [selections, setTaskSandboxSelections] = useState<
    Record<string, TaskSandboxSelection | null | undefined>
  >({});
  const binding = useMemo(() => latestTaskSandbox(messages), [messages]);
  useEffect(() => {
    let selection: TaskSandboxSelection | null = null;
    try {
      const saved: unknown = JSON.parse(
        window.localStorage.getItem(storageKey) ?? "null"
      );
      if (
        saved &&
        typeof saved === "object" &&
        "sandboxId" in saved &&
        typeof saved.sandboxId === "string" &&
        "observedCallId" in saved &&
        (saved.observedCallId === null ||
          typeof saved.observedCallId === "string")
      )
        selection = saved as TaskSandboxSelection;
    } catch {
      /* Storage is optional; transcript bindings remain authoritative. */
    }
    setTaskSandboxSelections((current) =>
      storageKey in current ? current : { ...current, [storageKey]: selection }
    );
  }, [storageKey]);
  const selectSandbox = useCallback(
    (sandboxId: string) => {
      const selection = { sandboxId, observedCallId: binding?.callId ?? null };
      setTaskSandboxSelections((current) => ({
        ...current,
        [storageKey]: selection,
      }));
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(selection));
      } catch {
        /* Keep the in-memory selection. */
      }
    },
    [binding?.callId, storageKey]
  );
  const selected = selections[storageKey];
  const activeSandbox =
    selected === undefined
      ? null
      : resolveTaskSandbox(sandboxes, selected, binding);
  return { activeSandbox, selectSandbox };
}
