"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "@/hooks/use-toast";
import { useRepos } from "@/hooks/use-repos";

type SlackInstallation = {
  teamId: string;
  teamName: string | null;
  botUserId: string;
  scopes: string[];
  installedAt: string;
  repoAgentEnabled: boolean;
  allowedSlackUserIds: string[] | null;
  monthlyRepoRunLimit: number | null;
};

type SlackChannelLink = {
  id: string;
  channelId: string;
  channelName: string | null;
  repoId: string;
  createdAt: string;
};

type SlackChannel = {
  id: string;
  name: string | null;
  isPrivate: boolean;
};

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API error: ${r.status}`);
  return r.json();
};

const logRevalidationFailure = (site: string) => (err: unknown) =>
  console.error(`[SlackSection] failed to revalidate ${site}:`, err);

export function SlackSection() {
  const { data, error, isLoading, mutate } = useSWR<{
    installations: SlackInstallation[];
  }>("/api/integrations/slack/installations", fetcher);

  const installations = data?.installations ?? [];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-end">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- OAuth start endpoint, needs full-page navigation */}
        <a
          href="/api/integrations/slack/install"
          className="px-2 py-1 text-[11px] rounded border border-purple-400/40 text-purple-300 hover:bg-purple-400/10"
        >
          {installations.length === 0 ? "Install to Slack" : "Add workspace"}
        </a>
      </div>

      {isLoading && (
        <div className="text-[11px] text-muted-foreground">
          Loading workspaces…
        </div>
      )}
      {error && (
        <div className="text-[11px] text-red-400">
          Failed to load Slack workspaces.
        </div>
      )}

      {!isLoading && installations.length === 0 && !error && (
        <div className="text-[11px] text-muted-foreground leading-snug">
          Connect a Slack workspace so the Mogplex bot can answer DMs and
          run repo agents from channels.
        </div>
      )}

      <div className="space-y-2">
        {installations.map((inst) => (
          <SlackInstallationRow
            key={inst.teamId}
            installation={inst}
            onChanged={() =>
              mutate().catch(logRevalidationFailure("after disconnect"))
            }
          />
        ))}
      </div>
    </div>
  );
}

function SlackInstallationRow({
  installation,
  onChanged,
}: {
  installation: SlackInstallation;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    if (
      !confirm(
        `Disconnect Mogplex from ${installation.teamName ?? installation.teamId}? Channel links will be removed.`
      )
    )
      return;
    setRemoving(true);
    try {
      const r = await fetch(
        `/api/integrations/slack/installations/${installation.teamId}`,
        { method: "DELETE" }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast({ title: "Slack workspace disconnected" });
      onChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      toast({ title: "Failed to disconnect", description: msg });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="rounded border border-border-dim">
      <div className="flex items-center justify-between px-2 py-1.5">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 text-left text-[11px] text-foreground hover:text-purple-300"
        >
          <span className="font-medium">
            {installation.teamName ?? installation.teamId}
          </span>
          <span className="ml-2 text-muted-foreground">
            {expanded ? "▾" : "▸"} channel links
          </span>
        </button>
        <button
          onClick={() => void handleRemove()}
          disabled={removing}
          className="px-2 py-0.5 text-[11px] text-red-400 hover:bg-red-400/10 rounded disabled:opacity-50"
        >
          {removing ? "…" : "Disconnect"}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border-dim bg-background/40">
          <SlackPolicyControls
            installation={installation}
            onChanged={onChanged}
          />
          <ChannelLinkManager teamId={installation.teamId} />
        </div>
      )}
    </div>
  );
}

function SlackPolicyControls({
  installation,
  onChanged,
}: {
  installation: SlackInstallation;
  onChanged: () => void;
}) {
  const [repoAgentEnabled, setRepoAgentEnabled] = useState(
    installation.repoAgentEnabled
  );
  const [allowedText, setAllowedText] = useState(
    (installation.allowedSlackUserIds ?? []).join("\n")
  );
  const [monthlyLimit, setMonthlyLimit] = useState(
    installation.monthlyRepoRunLimit?.toString() ?? ""
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRepoAgentEnabled(installation.repoAgentEnabled);
    setAllowedText((installation.allowedSlackUserIds ?? []).join("\n"));
    setMonthlyLimit(installation.monthlyRepoRunLimit?.toString() ?? "");
  }, [installation]);

  const handleSave = async () => {
    const allowedSlackUserIds = allowedText
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const trimmedLimit = monthlyLimit.trim();
    const parsedLimit = trimmedLimit ? Number(trimmedLimit) : null;
    if (
      parsedLimit !== null &&
      (!Number.isInteger(parsedLimit) || parsedLimit <= 0)
    ) {
      toast({
        title: "Invalid monthly limit",
        description: "Use a positive whole number or leave it blank.",
      });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(
        `/api/integrations/slack/installations/${installation.teamId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            repoAgentEnabled,
            allowedSlackUserIds:
              allowedSlackUserIds.length > 0 ? allowedSlackUserIds : null,
            monthlyRepoRunLimit: parsedLimit,
          }),
        }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      toast({ title: "Slack controls updated" });
      onChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      toast({ title: "Failed to update Slack controls", description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 px-2 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <label className="flex items-center gap-2 text-foreground">
          <input
            type="checkbox"
            checked={repoAgentEnabled}
            onChange={(event) => setRepoAgentEnabled(event.target.checked)}
            className="size-3.5 rounded border-border bg-background"
          />
          Repo agent runs
        </label>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save controls"}
        </button>
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_120px]">
        <label className="space-y-1 text-[11px] text-muted-foreground">
          <span>Allowed Slack user IDs</span>
          <textarea
            value={allowedText}
            onChange={(event) => setAllowedText(event.target.value)}
            placeholder="U12345, U67890"
            className="min-h-14 w-full rounded border border-border bg-input px-2 py-1 text-[11px] text-foreground"
          />
        </label>
        <label className="space-y-1 text-[11px] text-muted-foreground">
          <span>Monthly limit</span>
          <input
            value={monthlyLimit}
            onChange={(event) => setMonthlyLimit(event.target.value)}
            inputMode="numeric"
            placeholder="Unlimited"
            className="w-full rounded border border-border bg-input px-2 py-1 text-[11px] text-foreground"
          />
        </label>
      </div>
    </div>
  );
}

function ChannelLinkManager({ teamId }: { teamId: string }) {
  const linksKey = `/api/integrations/slack/installations/${teamId}/links`;
  const channelsKey = `/api/integrations/slack/installations/${teamId}/channels`;
  const { data: linksData, mutate: mutateLinks } = useSWR<{
    links: SlackChannelLink[];
  }>(linksKey, fetcher);
  const { data: channelsData, error: channelsError } = useSWR<{
    channels: SlackChannel[];
    nextCursor: string | null;
  }>(channelsKey, fetcher);
  const { repos } = useRepos();

  const [channelId, setChannelId] = useState("");
  const [repoId, setRepoId] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [extraChannels, setExtraChannels] = useState<SlackChannel[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMoreChannels, setLoadingMoreChannels] = useState(false);

  const links = linksData?.links ?? [];
  const channels = Array.from(
    new Map(
      [...(channelsData?.channels ?? []), ...extraChannels].map((channel) => [
        channel.id,
        channel,
      ])
    ).values()
  );
  const linkedChannelIds = new Set(links.map((l) => l.channelId));
  const availableChannels = channels.filter(
    (c) => !linkedChannelIds.has(c.id)
  );

  useEffect(() => {
    setExtraChannels([]);
    setNextCursor(channelsData?.nextCursor ?? null);
  }, [channelsData]);

  const channelLabel = (id: string) => {
    const found = channels.find((c) => c.id === id);
    if (!found) return id;
    return found.isPrivate ? `🔒 ${found.name ?? id}` : `#${found.name ?? id}`;
  };

  const repoLabel = (id: string) => {
    const found = repos.find((r) => r.id === id);
    return found?.full_name ?? id;
  };

  const handleAdd = async () => {
    if (!channelId || !repoId) return;
    setSaving(true);
    try {
      const selected = channels.find((c) => c.id === channelId);
      const r = await fetch(linksKey, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channelId,
          channelName: selected?.name ?? null,
          repoId,
        }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `HTTP ${r.status}`);
      }
      toast({ title: "Channel linked" });
      setChannelId("");
      setRepoId("");
      mutateLinks().catch(logRevalidationFailure("links after add"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      toast({ title: "Failed to link channel", description: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (linkId: string) => {
    setDeletingId(linkId);
    try {
      const r = await fetch(`${linksKey}/${linkId}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      mutateLinks().catch(logRevalidationFailure("links after delete"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      toast({ title: "Failed to remove link", description: msg });
    } finally {
      setDeletingId(null);
    }
  };

  const handleLoadMoreChannels = async () => {
    if (!nextCursor) return;
    setLoadingMoreChannels(true);
    try {
      const data = (await fetcher(
        `${channelsKey}?cursor=${encodeURIComponent(nextCursor)}`
      )) as { channels: SlackChannel[]; nextCursor: string | null };
      setExtraChannels((current) => [...current, ...data.channels]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      toast({ title: "Failed to load Slack channels", description: msg });
    } finally {
      setLoadingMoreChannels(false);
    }
  };

  return (
    <div className="border-t border-border-dim px-2 py-2 space-y-2">
      {links.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">
          No channel links yet. When linked, an `@mogplex` mention in that
          channel kicks off a repo agent run instead of a chat reply.
        </div>
      ) : (
        <div className="space-y-1">
          {links.map((link) => (
            <div
              key={link.id}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <div className="flex-1 truncate text-foreground">
                <span className="text-purple-300">
                  {link.channelName
                    ? `#${link.channelName}`
                    : channelLabel(link.channelId)}
                </span>
                <span className="mx-1 text-muted-foreground">→</span>
                <span className="text-muted-foreground">
                  {repoLabel(link.repoId)}
                </span>
              </div>
              <button
                onClick={() => void handleDelete(link.id)}
                disabled={deletingId === link.id}
                className="text-red-400 hover:bg-red-400/10 px-1.5 py-0.5 rounded disabled:opacity-50"
                aria-label="Remove channel link"
              >
                {deletingId === link.id ? "…" : "✕"}
              </button>
            </div>
          ))}
        </div>
      )}

      {channelsError && (
        <div className="text-[11px] text-amber-400">
          Couldn&apos;t list channels — invite the bot to the channels you
          want to link, or check the workspace install.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          className="flex-1 min-w-[140px] px-1.5 py-1 bg-input border border-border text-[11px] text-foreground rounded"
        >
          <option value="">Select channel…</option>
          {availableChannels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.isPrivate ? "🔒 " : "#"}
              {c.name ?? c.id}
            </option>
          ))}
        </select>
        <select
          value={repoId}
          onChange={(e) => setRepoId(e.target.value)}
          className="flex-1 min-w-[140px] px-1.5 py-1 bg-input border border-border text-[11px] text-foreground rounded"
        >
          <option value="">Select repo…</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.full_name}
            </option>
          ))}
        </select>
        <button
          onClick={() => void handleAdd()}
          disabled={!channelId || !repoId || saving}
          className="px-2 py-1 text-[11px] bg-primary text-primary-foreground rounded disabled:opacity-50"
        >
          {saving ? "…" : "Link"}
        </button>
      </div>
      {nextCursor && (
        <button
          onClick={() => void handleLoadMoreChannels()}
          disabled={loadingMoreChannels}
          className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {loadingMoreChannels ? "Loading channels…" : "Load more channels"}
        </button>
      )}
    </div>
  );
}
