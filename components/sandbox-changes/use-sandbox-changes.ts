"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const scope = useMemo(
    () => ({
      sandboxId,
      active: false,
      requestId: 0,
      ready: false,
      busy: false,
    }),
    [sandboxId]
  );
  const empty = {
    changes: null,
    loading: Boolean(sandboxId),
    busy: false,
    error: null,
  };
  const [state, setState] = useState<{
    scope: typeof scope;
    changes: SandboxChanges | null;
    loading: boolean;
    busy: boolean;
    error: string | null;
  }>({ scope, ...empty });
  const { changes, loading, busy, error } =
    state.scope === scope ? state : empty;
  const update = useCallback(
    (patch: Partial<Omit<typeof state, "scope">>) => {
      if (!scope.active) return;
      setState((previous) => ({
        ...(previous.scope === scope
          ? previous
          : {
              changes: null,
              loading: Boolean(scope.sandboxId),
              busy: false,
              error: null,
            }),
        ...patch,
        scope,
      }));
    },
    [scope]
  );

  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      scope.requestId += 1;
    };
  }, [scope]);

  const endpoint = sandboxId
    ? `/api/sandbox/${encodeURIComponent(sandboxId)}/changes`
    : null;

  const refresh = useCallback(async () => {
    if (!endpoint || !scope.active || scope.busy) return;
    const id = ++scope.requestId;
    scope.ready = false;
    update({ loading: true });
    try {
      const res = await fetch(endpoint, {
        headers: getActiveTeamRequestHeaders(),
      });
      if (!res.ok) {
        const message = await readError(res, "Could not read changes");
        if (id === scope.requestId) update({ error: message, changes: null });
        return;
      }
      const payload = (await res.json()) as SandboxChanges;
      if (!scope.active || id !== scope.requestId) return;
      scope.ready = true;
      update({ changes: payload, error: null });
    } catch (err) {
      if (id === scope.requestId) {
        update({
          changes: null,
          error: err instanceof Error ? err.message : "Could not read changes",
        });
      }
    } finally {
      if (id === scope.requestId) update({ loading: false });
    }
  }, [endpoint, scope, update]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  const loadDiff = useCallback(
    async (path: string): Promise<string | null> => {
      if (!endpoint || !scope.active || !scope.ready) return null;
      const id = scope.requestId;
      const res = await fetch(`${endpoint}?path=${encodeURIComponent(path)}`, {
        headers: getActiveTeamRequestHeaders(),
      });
      if (!res.ok) {
        const message = await readError(res, "Could not read the diff");
        if (id === scope.requestId) update({ error: message });
        return null;
      }
      const body = (await res.json()) as { diff?: string };
      if (!scope.active || id !== scope.requestId) return null;
      return body.diff ?? "";
    },
    [endpoint, scope, update]
  );

  const post = useCallback(
    async (body: Record<string, unknown>, fallback: string) => {
      if (!endpoint || !scope.active || !scope.ready || scope.busy) return null;
      const id = ++scope.requestId;
      scope.busy = true;
      update({ busy: true });
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: getActiveTeamRequestHeaders({
            "content-type": "application/json",
          }),
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const message = await readError(res, fallback);
          if (id === scope.requestId) update({ error: message });
          return null;
        }
        const payload = (await res.json()) as { changes?: SandboxChanges };
        if (!scope.active || id !== scope.requestId) return null;
        update({
          ...(payload.changes ? { changes: payload.changes } : {}),
          error: null,
        });
        return payload;
      } catch (err) {
        if (id === scope.requestId)
          update({ error: err instanceof Error ? err.message : fallback });
        return null;
      } finally {
        if (id === scope.requestId) {
          scope.busy = false;
          update({ busy: false });
        }
      }
    },
    [endpoint, scope, update]
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
