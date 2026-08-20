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

export type SandboxReadinessWaitResult =
  | { kind: "ready"; snapshot: SandboxReadinessSnapshot }
  | { kind: "failed"; message: string };

export const SANDBOX_READINESS_TIMEOUT_MS = 10 * 60 * 1000;

type SandboxReadinessWaitDeps = {
  createListener: () => Promise<TableEventListener>;
  loadSnapshot: (
    sandboxRecordId: string
  ) => Promise<SandboxReadinessSnapshot | null>;
};

async function loadSandboxReadinessSnapshot(sandboxRecordId: string) {
  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .select(
      "id, user_id, status, health_status, preview_url, error, last_boot_error"
    )
    .eq("id", sandboxRecordId)
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
    (!payload.user_id || payload.user_id === userId)
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
  const listener = await deps.createListener();

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (
      result: SandboxReadinessWaitResult | null,
      finishError?: unknown
    ) => {
      if (settled || (!result && !finishError)) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      void listener.end().catch(() => undefined);
      if (finishError) reject(finishError);
      else resolve(result!);
    };

    const check = async () => {
      if (settled) return;
      try {
        const snapshot = await deps.loadSnapshot(input.sandboxRecordId);
        finish(resolveSnapshot(snapshot));
      } catch (error) {
        finish(null, error);
      }
    };

    const abort = () => {
      finish(null, input.signal?.reason ?? new Error("Sandbox wait aborted"));
    };

    listener.onNotification((payload) => {
      if (
        isMatchingSandboxEvent(payload, input.sandboxRecordId, input.userId)
      ) {
        void check();
      }
    });
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
      // Subscribe first, then read once to close the read/subscribe race.
      void check();
    }
  });
}
