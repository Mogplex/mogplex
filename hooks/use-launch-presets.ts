"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  SandboxLaunchPreset,
  SandboxLaunchPresetInput,
} from "@/lib/launch-presets/shared";

type Status = "idle" | "loading" | "ready" | "error";

type FetchState = {
  status: Status;
  presets: SandboxLaunchPreset[];
  error: string | null;
};

const INITIAL_STATE: FetchState = {
  status: "idle",
  presets: [],
  error: null,
};

/**
 * Fetches and mutates the launch presets for a single repo. Designed
 * for the SandboxLaunchProvider dialog: pass `repoId = null` while the
 * dialog is closed and the hook stays inert; pass the active repo id
 * when the dialog opens to trigger a fetch.
 *
 * Mutation methods optimistically update the local list so the UI
 * stays snappy on save/delete; failures restore the prior state and
 * surface the error to the caller.
 */
export function useLaunchPresets(repoId: string | null | undefined) {
  const [state, setState] = useState(INITIAL_STATE);
  // Track the latest mutation epoch so an in-flight initial GET can
  // tell whether local state has moved since it started. Stale GET
  // responses are dropped rather than overwriting newer optimistic
  // saves/deletes.
  //
  // Declared at the top of the hook so the useEffect below can close
  // over it without a forward reference. The epoch is only bumped
  // AFTER a mutation actually changes setState (not at call entry) so
  // a save that fails before any local change leaves the epoch
  // untouched and lets in-flight GETs reconcile cleanly.
  const localMutationEpochRef = useRef(0);

  // Reset when repoId changes; otherwise the dialog could briefly show
  // presets from a previously-opened repo.
  useEffect(() => {
    setState(INITIAL_STATE);
  }, [repoId]);

  useEffect(() => {
    if (!repoId) return;
    let cancelled = false;
    // Capture the mutation epoch at the start of this fetch. If a
    // save/delete bumps the epoch before the GET resolves, drop the
    // GET response — it would clobber the user's optimistic
    // mutation with stale server data (just-saved preset disappears,
    // or just-deleted preset reappears).
    const startEpoch = localMutationEpochRef.current;
    setState((prev) => ({ ...prev, status: "loading", error: null }));

    const load = async () => {
      try {
        const res = await fetch(`/api/repos/${repoId}/launch-presets`, {
          method: "GET",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          presets?: SandboxLaunchPreset[];
        };
        if (cancelled) return;
        if (localMutationEpochRef.current !== startEpoch) {
          // Local state has moved; only reconcile the loading flag
          // so the spinner clears, but keep the optimistic data.
          setState((prev) =>
            prev.status === "loading"
              ? { ...prev, status: "ready", error: null }
              : prev
          );
          return;
        }
        setState({
          status: "ready",
          presets: data.presets ?? [],
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        console.error("[launch-presets] fetch failed", { repoId, error });
        setState({
          status: "error",
          presets: [],
          error: error instanceof Error ? error.message : "Failed to load",
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [repoId]);

  const savePreset = useCallback(
    async (input: SandboxLaunchPresetInput): Promise<SandboxLaunchPreset> => {
      if (!repoId) throw new Error("No repo selected");
      const res = await fetch(`/api/repos/${repoId}/launch-presets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        preset?: SandboxLaunchPreset;
      };
      if (!res.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      // Defensive: a 200 with a malformed body (proxy/CDN edge case
      // or future refactor stripping the field) would otherwise push
      // `undefined` into the presets array and crash the chip render.
      const preset = body.preset;
      if (!preset) {
        throw new Error("Server returned no preset data");
      }
      // Bump the epoch only after we know the mutation succeeded and
      // we're about to change local state — a failed save leaves the
      // epoch untouched so an in-flight initial GET still reconciles.
      localMutationEpochRef.current += 1;
      setState((prev) => {
        const next = prev.presets.filter((p) => p.id !== preset.id);
        return {
          ...prev,
          status: "ready",
          presets: [preset, ...next],
        };
      });
      return preset;
    },
    [repoId]
  );

  const deletePreset = useCallback(
    async (presetId: string) => {
      if (!repoId) throw new Error("No repo selected");
      // Bump the epoch as we apply the optimistic remove — local
      // state IS changing now.
      localMutationEpochRef.current += 1;
      // Snapshot inside the functional updater so we always read the
      // newest state — guards against a concurrent savePreset that
      // landed between the user clicking delete and our optimistic
      // remove. Without this, a failed delete would roll back to a
      // snapshot missing the just-saved preset.
      let snapshot: SandboxLaunchPreset[] = [];
      setState((prev) => {
        snapshot = prev.presets;
        return {
          ...prev,
          presets: prev.presets.filter((p) => p.id !== presetId),
        };
      });
      const res = await fetch(
        `/api/repos/${repoId}/launch-presets/${presetId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        // Roll the epoch back too: the local state is now identical
        // to what the server has, so any in-flight initial GET must
        // be free to reconcile rather than being dropped as "stale".
        // Without this the dialog could stay open after a failed
        // delete and never see the server's true list refresh.
        //
        // Safe only because mutations within a single dialog instance
        // are sequential — the launch dialog's UI prevents
        // simultaneous save+delete from overlapping. If a future
        // refactor introduces parallel mutations on the same hook
        // instance, swap this for an "active mutation count" pattern
        // so a concurrent savePreset bump can't be silently
        // subtracted away here.
        localMutationEpochRef.current -= 1;
        setState((prev) => ({ ...prev, presets: snapshot }));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
    },
    [repoId]
  );

  return {
    ...state,
    savePreset,
    deletePreset,
  };
}
