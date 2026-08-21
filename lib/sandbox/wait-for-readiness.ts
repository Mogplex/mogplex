import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  createTableEventListener,
  type TableEventListener,
  type TableEventPayload,
} from "@/lib/db/table-event-listener";

export type SandboxReadinessSnapshot = {
  id: string;
  user_id: string;
  status: string;
  health_status?: string | null;
  preview_url?: string | null;
  error?: string | null;
  last_boot_error?: string | null;
};

/**
 * Known sandbox outcomes and the safety timeout resolve through this union.
 * Neon listener/read failures resolve as `retry` so the internal stream caller
 * can reattach once without polling. Caller cancellation still rejects.
 */
export type SandboxReadinessWaitResult =
  | { kind: "ready"; snapshot: SandboxReadinessSnapshot }
  | { kind: "failed"; message: string }
  | { kind: "retry"; message: string };

export const SANDBOX_READINESS_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_LISTENER_RECONNECTS = 3;
const READINESS_RETRY_MESSAGE =
  "Sandbox readiness connection was interrupted. Reconnect to continue waiting.";

type SandboxReadinessWaitDeps = {
  createListener: () => Promise<TableEventListener>;
  loadSnapshot: (
    sandboxRecordId: string,
    userId: string
  ) => Promise<SandboxReadinessSnapshot | null>;
};

async function loadSandboxReadinessSnapshot(
  sandboxRecordId: string,
  userId: string
) {
  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .select(
      "id, user_id, status, health_status, preview_url, error, last_boot_error"
    )
    .eq("id", sandboxRecordId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load sandbox readiness for ${sandboxRecordId}: ${error.message}`
    );
  }
  return (data as SandboxReadinessSnapshot | null) ?? null;
}

function resolveSnapshot(
  snapshot: SandboxReadinessSnapshot | null
): SandboxReadinessWaitResult | null {
  if (!snapshot) {
    return { kind: "failed", message: "Sandbox record no longer exists." };
  }
  if (snapshot.status === "running") {
    return { kind: "ready", snapshot };
  }
  if (
    snapshot.status === "stopped" ||
    snapshot.status === "error" ||
    snapshot.status === "paused"
  ) {
    return {
      kind: "failed",
      message:
        snapshot.error ||
        snapshot.last_boot_error ||
        (snapshot.status === "stopped"
          ? "Sandbox stopped before it became ready."
          : snapshot.status === "paused"
            ? "Sandbox paused before it became ready."
            : "Sandbox failed before it became ready."),
    };
  }
  return null;
}

function isMatchingSandboxEvent(
  payload: TableEventPayload,
  sandboxRecordId: string,
  userId: string
) {
  return (
    payload.table === "sandboxes" &&
    payload.id === sandboxRecordId &&
    payload.user_id === userId
  );
}

/** Wait for one sandbox to settle using Neon notifications, never polling. */
export async function waitForSandboxReadiness(
  input: {
    sandboxRecordId: string;
    userId: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
  overrides: Partial<SandboxReadinessWaitDeps> = {}
): Promise<SandboxReadinessWaitResult> {
  const deps: SandboxReadinessWaitDeps = {
    createListener: createTableEventListener,
    loadSnapshot: loadSandboxReadinessSnapshot,
    ...overrides,
  };
  const retryResult = (): SandboxReadinessWaitResult => ({
    kind: "retry",
    message: READINESS_RETRY_MESSAGE,
  });
  const loadSnapshotWithRetry = async () => {
    try {
      return await deps.loadSnapshot(input.sandboxRecordId, input.userId);
    } catch {
      // One immediate retry absorbs a transient Neon-backed read failure
      // without turning readiness into a status-polling loop.
      return deps.loadSnapshot(input.sandboxRecordId, input.userId);
    }
  };

  let initialListener: TableEventListener;
  try {
    initialListener = await deps.createListener();
  } catch {
    try {
      const terminalResult = resolveSnapshot(await loadSnapshotWithRetry());
      return terminalResult ?? retryResult();
    } catch {
      return retryResult();
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let activeListener: TableEventListener | null = initialListener;
    let reconnectAttempts = 0;

    const finish = (
      result: SandboxReadinessWaitResult | null,
      finishError?: unknown
    ) => {
      if (settled || (!result && !finishError)) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      const listener = activeListener;
      activeListener = null;
      void listener?.end().catch(() => undefined);
      if (finishError) reject(finishError);
      else resolve(result!);
    };

    const check = async () => {
      if (settled) return;
      try {
        const snapshot = await loadSnapshotWithRetry();
        finish(resolveSnapshot(snapshot));
      } catch {
        finish(retryResult());
      }
    };

    const abort = () => {
      finish(null, input.signal?.reason ?? new Error("Sandbox wait aborted"));
    };

    const finishAfterListenerFailure = async () => {
      try {
        const snapshot = await loadSnapshotWithRetry();
        const terminalResult = resolveSnapshot(snapshot);
        if (terminalResult) finish(terminalResult);
        else finish(retryResult());
      } catch {
        finish(retryResult());
      }
    };

    const reconnect = async (
      failedListener: TableEventListener,
      _error: Error
    ) => {
      if (settled || activeListener !== failedListener) return;
      if (reconnectAttempts >= MAX_LISTENER_RECONNECTS) {
        activeListener = null;
        void failedListener.end().catch(() => undefined);
        void finishAfterListenerFailure();
        return;
      }
      reconnectAttempts += 1;
      activeListener = null;
      void failedListener.end().catch(() => undefined);

      try {
        const replacement = await deps.createListener();
        if (settled) {
          void replacement.end().catch(() => undefined);
          return;
        }
        activeListener = replacement;
        subscribe(replacement);
        // Subscribe first, then read once to close the reconnect race.
        void check();
      } catch {
        void finishAfterListenerFailure();
      }
    };

    const subscribe = (listener: TableEventListener) => {
      listener.onNotification((payload) => {
        if (
          activeListener === listener &&
          isMatchingSandboxEvent(payload, input.sandboxRecordId, input.userId)
        ) {
          void check();
        }
      });
      listener.onError((error) => void reconnect(listener, error));
    };

    timeout = setTimeout(
      () =>
        finish({
          kind: "failed",
          message: "Sandbox did not become ready before the wait timed out.",
        }),
      input.timeoutMs ?? SANDBOX_READINESS_TIMEOUT_MS
    );
    if (input.signal?.aborted) abort();
    else {
      input.signal?.addEventListener("abort", abort, { once: true });
      subscribe(initialListener);
      // Subscribe first, then read once to close the read/subscribe race.
      void check();
    }
  });
}
