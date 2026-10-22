"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { fetchTeamSettingsJson } from "./team-settings-helpers";
import { Switch } from "@/components/ui/switch";

type JoinSetting = {
  enabled: boolean;
  domain: string | null;
  eligibleDomain: string | null;
  viewer: { canManage: boolean };
};

export function TeamJoinSettings({ teamId }: { teamId: string }) {
  const endpoint = `/api/teams/${teamId}/signup-domain`;
  const { data, error, mutate } = useSWR<JoinSetting>(endpoint, (url: string) =>
    fetchTeamSettingsJson<JoinSetting>(teamId, url)
  );
  const { mutate: mutateCache } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function save(url: string, method: string, body: unknown) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(url, { method,
        headers: getActiveTeamRequestHeaders({ "Content-Type": "application/json" }, teamId),
        body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save.");
      if (method === "PATCH") {
        await mutate(payload, { revalidate: false });
        setMessage("Team access saved.");
      } else {
        setEmail("");
        await mutateCache(`/api/teams/${teamId}/members`);
        setMessage("Member added with Developer access.");
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }

  const domain = data?.domain || (data?.viewer.canManage ? data.eligibleDomain : null);
  const canEnable = Boolean(data?.eligibleDomain && (!data.domain || data.domain === data.eligibleDomain));
  return (
    <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
      <div>
        <div className="ui-section-title">Let teammates join</div>
        <p className="ui-section-caption">Add an existing account or let people with your work email domain join automatically.</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">Unable to load this setting.</p>}
      <div className="flex items-start justify-between gap-4">
        <div>
          <label htmlFor={`domain-join-${teamId}`} className="text-sm font-medium">
            Allow people from {domain ? `@${domain}` : "this email domain"} to join
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            A verified email is required. People join as Developers when they sign in. Subdomains need their own setting.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Turn this off to stop future joins. Current members keep their access. Removed members cannot rejoin automatically.
          </p>
          {data?.viewer.canManage && !data.eligibleDomain && !data.domain && (
            <p className="mt-1 text-xs text-muted-foreground">Verify a work email to enable this setting. Shared email services are not supported.</p>
          )}
          {data?.viewer.canManage && data.domain && !data.enabled && !canEnable && (
            <p className="mt-1 text-xs text-muted-foreground">Use a verified @{data.domain} email to turn this on.</p>
          )}
        </div>
        <Switch id={`domain-join-${teamId}`} checked={data?.enabled === true}
          disabled={!data || Boolean(error) || busy || !data.viewer.canManage || (!data.enabled && !canEnable)}
          onCheckedChange={(enabled) => void save(endpoint, "PATCH", { enabled })} />
      </div>
      {data?.viewer.canManage && (
        <div className="space-y-2 border-t border-border/40 pt-4">
          <label htmlFor={`existing-member-${teamId}`} className="text-sm">Add someone who already signed up</label>
          <div className="flex flex-wrap gap-2">
            <input id={`existing-member-${teamId}`} type="email" value={email}
              onChange={(event) => setEmail(event.target.value)} placeholder="teammate@example.com"
              className="min-w-0 flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
            <button type="button" disabled={busy || !email.trim()}
              onClick={() => void save(`/api/teams/${teamId}/members/add`, "POST", { email, role: "developer" })}
              className="border border-border px-3 py-2 text-sm hover:bg-secondary disabled:opacity-50">Add member</button>
          </div>
          <p className="text-xs text-muted-foreground">Adds a verified account with Developer access. No invitation is needed.</p>
        </div>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>
  );
}
