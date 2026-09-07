"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import type {
  SandboxChanges,
  SandboxCommitResult,
} from "@/lib/sandbox/changes";

export type CommitChangesInput = {
  message: string;
  push: boolean;
  openPullRequest: boolean;
};

async function readError(res: Response, fallback: string) {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === "string" ? body.error : fallback;
}

/**
 * Live working-tree state of the pane's sandbox. Refreshes on mount, when
 * `refreshToken` changes (the pane bumps it when a turn ends), and after
 * every revert or commit.
 */
export function useSandboxChanges(input: {
  sandboxId: string | null;
  refreshToken: number;
}) {
  const { sandboxId, refreshToken } = input;
  const [changes, setChanges] = useState<SandboxChanges | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const endpoint = sandboxId
    ? `/api/sandbox/${encodeURIComponent(sandboxId)}/changes`
    : null;

  const refresh = useCallback(async () => {
    if (!endpoint) {
      setChanges(null);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        headers: getActiveTeamRequestHeaders(),
      });
      if (id !== requestId.current) return;
      if (!res.ok) {
        setError(await readError(res, "Could not read changes"));
        return;
      }
      setChanges((await res.json()) as SandboxChanges);
      setError(null);
    } catch (err) {
      if (id === requestId.current) {
        setError(err instanceof Error ? err.message : "Could not read changes");
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  const loadDiff = useCallback(
    async (path: string): Promise<string | null> => {
      if (!endpoint) return null;
      const res = await fetch(`${endpoint}?path=${encodeURIComponent(path)}`, {
        headers: getActiveTeamRequestHeaders(),
      });
      if (!res.ok) {
        setError(await readError(res, "Could not read the diff"));
        return null;
      }
      const body = (await res.json()) as { diff?: string };
      return body.diff ?? "";
    },
    [endpoint]
  );

  const post = useCallback(
    async (body: Record<string, unknown>, fallback: string) => {
      if (!endpoint) return null;
      setBusy(true);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: getActiveTeamRequestHeaders({
            "content-type": "application/json",
          }),
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          setError(await readError(res, fallback));
          return null;
        }
        const payload = (await res.json()) as { changes?: SandboxChanges };
        if (payload.changes) setChanges(payload.changes);
        setError(null);
        return payload;
      } catch (err) {
        setError(err instanceof Error ? err.message : fallback);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [endpoint]
  );

  const revert = useCallback(
    async (paths: string[]) =>
      (await post({ action: "revert", paths }, "Revert failed")) !== null,
    [post]
  );

  const commit = useCallback(
    async (commitInput: CommitChangesInput) =>
      (await post({ action: "commit", ...commitInput }, "Commit failed")) as
        | (SandboxCommitResult & { changes?: SandboxChanges })
        | null,
    [post]
  );

  return { changes, loading, busy, error, refresh, loadDiff, revert, commit };
}
