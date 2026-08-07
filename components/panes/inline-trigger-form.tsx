"use client";

import { useState } from "react";
import useSWR from "swr";
import type { Agent, TriggerEvent } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import { InstallationCombobox } from "./installation-combobox";
import type {
  AuthUserResponse,
  Installation,
  RepoSummary,
} from "./triggers-pane-types";
import { EVENT_OPTIONS, fetcher } from "./triggers-pane-types";

interface InlineTriggerFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

export function InlineTriggerForm({
  onCreated,
  onCancel,
}: InlineTriggerFormProps) {
  const { data: installations } = useSWR<Installation[]>(
    "/api/github/installations",
    fetcher
  );
  const { data: agents } = useSWR<Agent[]>("/api/agents", fetcher);
  const { data: authData } = useSWR<AuthUserResponse>("/api/auth/user", fetcher);
  const { data: repos } = useSWR<RepoSummary[]>("/api/repos", fetcher);
  const [installationId, setInstallationId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [event, setEvent] = useState<TriggerEvent>("mention");
  const [saving, setSaving] = useState(false);

  const installationCount = installations?.length ?? 0;
  const syncedRepoCount = repos?.length ?? 0;
  const user = authData?.user ?? null;

  if (installations && installationCount === 0) {
    const actionLabel =
      user?.github_primary_action?.label ||
      (user?.github_app_available ? "Install GitHub App" : "Connect GitHub");
    const actionHref = user?.github_primary_action?.href || "/api/auth/github";
    const currentConnection =
      user?.github_status_label ||
      (user?.github_connection_mode === "oauth"
        ? "GitHub OAuth"
        : user?.github_connected
          ? "GitHub connected"
          : "Not connected");

    return (
      <div className="border-b border-border bg-secondary/50 p-4">
        <div className="rounded-lg border border-accent-blue/20 bg-accent-blue/5 p-4">
          <div className="text-sm font-medium text-foreground">
            Install the GitHub App to create triggers
          </div>
          <div className="mt-2 text-sm leading-6 text-muted-foreground">
            Triggered agents listen to GitHub webhooks from a GitHub App
            installation. Synced repos on their own will not appear here until
            the Mogplex GitHub App is installed on the account or org that owns
            them.
          </div>
          <div className="mt-3 space-y-1 text-sm text-muted-foreground">
            <div>
              Current connection: {currentConnection}
              {user?.github_username ? ` · ${user.github_username}` : ""}
            </div>
            <div>
              Synced repos: {syncedRepoCount}
              {syncedRepoCount > 0 ? " available after App install" : ""}
            </div>
            <div>Installations: {user?.github_installation_count ?? 0}</div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <a
              href={actionHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {actionLabel}
            </a>
            <button
              onClick={onCancel}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!installationId || !agentId || !event) return;
    setSaving(true);
    try {
      const res = await fetch("/api/triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installation_id: Number(installationId),
          agent_id: agentId,
          event,
          is_default: event === "mention",
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create trigger");
      }
      toast({ title: "Trigger created" });
      onCreated();
    } catch (e) {
      toast({
        title: "Error",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-border bg-secondary/50 p-3 space-y-2">
      <InstallationCombobox
        installations={installations || []}
        value={installationId}
        onChange={setInstallationId}
        emptyMessage="No GitHub App installations found yet."
      />
      <select
        value={event}
        onChange={(e) => setEvent(e.target.value as TriggerEvent)}
        className="w-full px-3 py-2 bg-input border border-border text-sm text-foreground rounded"
      >
        {EVENT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        value={agentId}
        onChange={(e) => setAgentId(e.target.value)}
        className="w-full px-3 py-2 bg-input border border-border text-sm text-foreground rounded"
      >
        <option value="">Select agent...</option>
        {(agents || []).map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.slug ? ` (${a.slug})` : ""}
          </option>
        ))}
      </select>
      {event === "mention" && (
        <div className="rounded border border-border/80 bg-card/60 px-3 py-2 text-xs text-muted-foreground">
          GitHub comments containing{" "}
          <span className="font-medium text-foreground">@mogplex</span> run this
          trigger.
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleCreate()}
          disabled={!installationId || !agentId || saving}
          className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create"}
        </button>
      </div>
    </div>
  );
}
