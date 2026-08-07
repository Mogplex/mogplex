"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "@/hooks/use-toast";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import type {
  AuthUserResponse,
  Installation,
  RepoSummary,
  TriggerWithAgent,
} from "./triggers-pane-types";
import {
  fetcher,
  getInstallationAccountScope,
  getInstallationLabel,
  getInstallationRepoSummary,
} from "./triggers-pane-types";
import { InlineTriggerForm } from "./inline-trigger-form";
import { TriggersEmptyState } from "./triggers-empty-state";
import { TriggerRow } from "./trigger-row";

export function TriggersPane() {
  const {
    data: triggers,
    mutate: mutateTriggers,
    isLoading,
  } = useSWR<TriggerWithAgent[]>("/api/triggers", fetcher);
  const { data: installations, mutate: mutateInstallations } = useSWR<
    Installation[]
  >("/api/github/installations", fetcher);
  const { data: authData } = useSWR<AuthUserResponse>("/api/auth/user", fetcher);
  const { data: repos, mutate: mutateRepos } = useSWR<RepoSummary[]>(
    "/api/repos",
    fetcher
  );
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const realtimeSpecs = useMemo(
    () => [
      { table: "triggers", filter: "user_id=eq.$USER_ID" },
      { table: "github_installations", filter: "user_id=eq.$USER_ID" },
      { table: "repos", filter: "user_id=eq.$USER_ID" },
      { table: "job_runs" },
      { table: "automation_dispatch_events", filter: "user_id=eq.$USER_ID" },
    ],
    []
  );
  const refreshAll = useCallback(
    () => Promise.all([mutateTriggers(), mutateInstallations(), mutateRepos()]),
    [mutateInstallations, mutateRepos, mutateTriggers]
  );

  useRealtimeRouteRefresh({
    channelName: "triggers-pane",
    specs: realtimeSpecs,
    onInvalidate: refreshAll,
  });

  const installationMap = new Map(
    (installations || []).map((i) => [i.installation_id, i])
  );

  const toggleEnabled = async (trigger: TriggerWithAgent) => {
    setTogglingId(trigger.id);
    try {
      await fetch("/api/triggers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: trigger.id, enabled: !trigger.enabled }),
      });
      await mutateTriggers();
    } catch {
      // SWR will refetch
    } finally {
      setTogglingId(null);
    }
  };

  const deleteTrigger = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/triggers?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      await mutateTriggers();
      toast({ title: "Trigger deleted" });
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete trigger",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 p-3 text-xs text-muted-foreground">
        Loading triggers...
      </div>
    );
  }

  const triggerList = triggers || [];
  const installationCount = installations?.length ?? 0;
  const syncedRepoCount = repos?.length ?? 0;
  const user = authData?.user ?? null;

  // Group by installation
  const grouped = new Map<number, TriggerWithAgent[]>();
  for (const t of triggerList) {
    const existing = grouped.get(t.installation_id) || [];
    existing.push(t);
    grouped.set(t.installation_id, existing);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-dim bg-secondary/20">
        <span className="text-sm text-muted-foreground">
          {triggerList.length} trigger{triggerList.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={() => setShowForm((f) => !f)}
          className="px-3 py-1.5 text-xs font-medium text-accent-blue hover:bg-accent-blue/10 rounded border border-accent-blue/20"
        >
          {showForm ? "Close form" : "New trigger"}
        </button>
      </div>

      {showForm && (
        <InlineTriggerForm
          onCreated={() => {
            setShowForm(false);
            void refreshAll();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="flex-1 overflow-auto">
        {triggerList.length === 0 && !showForm && (
          <TriggersEmptyState
            installationCount={installationCount}
            syncedRepoCount={syncedRepoCount}
            user={user}
            onCreateClick={() => setShowForm(true)}
          />
        )}
        {Array.from(grouped.entries()).map(([installId, items]) => {
          const inst = installationMap.get(installId);
          return (
            <div key={installId}>
              {grouped.size > 1 && (
                <div className="px-4 py-2 text-xs text-muted-foreground bg-secondary/30 border-b border-border-dim">
                  {inst
                    ? `${getInstallationLabel(inst)} · ${getInstallationAccountScope(inst)} · ${getInstallationRepoSummary(inst)}`
                    : `Installation ${installId}`}
                </div>
              )}
              {items.map((trigger) => (
                <TriggerRow
                  key={trigger.id}
                  trigger={trigger}
                  onToggle={() => void toggleEnabled(trigger)}
                  onDelete={() => void deleteTrigger(trigger.id)}
                  isToggling={togglingId === trigger.id}
                  isDeleting={deletingId === trigger.id}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
