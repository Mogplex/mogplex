"use client"
import { useCallback, useMemo, useState } from "react"
import useSWR from "swr"
import type { Agent, Trigger, TriggerEvent } from "@/lib/types"
import { toast } from "@/hooks/use-toast"
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`API error: ${r.status}`)
  return r.json()
}

type Installation = {
  id: string
  installation_id: number
  account_login: string | null
  account_type: string | null
  target_type: string | null
  repository_count?: number
  synced_repo_count?: number
  scope_label?: string
  manage_url?: string
  repositories: Array<{
    id: string
    full_name: string
  }>
}

type AuthUserResponse = {
  user: {
    github_connected: boolean
    github_app_available: boolean
    github_installation_count?: number
    github_synced_repo_count?: number
    github_state?: "disconnected" | "oauth_connected" | "app_install_pending" | "app_installed" | "app_installed_with_synced_repos"
    github_status_label?: string
    github_status_detail?: string
    github_primary_action?: {
      label: string
      href: string
    } | null
    github_connection_mode: "app" | "oauth" | null
    github_username: string | null
  } | null
}

type RepoSummary = {
  id: string
  full_name: string
  github_installation_id?: number | null
}

type TriggerWithAgent = Trigger & {
  agents: Pick<Agent, "id" | "name" | "slug" | "model"> | null
}

const EVENT_OPTIONS: { value: TriggerEvent; label: string }[] = [
  { value: "mention", label: "@mogplex" },
  { value: "pr_opened", label: "PR opened" },
  { value: "issue_opened", label: "Issue opened" },
  { value: "pr_comment", label: "PR comment" },
  { value: "issue_comment", label: "Issue comment" },
  { value: "push", label: "Push" },
  { value: "ci_failure", label: "CI failure" },
]

const EVENT_BADGES: Record<TriggerEvent, { label: string; color: string }> = {
  mention: { label: "@mogplex", color: "text-purple-400 border-purple-400/20 bg-purple-400/[0.06]" },
  pr_opened: { label: "PR", color: "text-accent-blue border-accent-blue/20 bg-accent-blue/[0.06]" },
  issue_opened: { label: "Issue", color: "text-amber-400 border-amber-400/20 bg-amber-400/[0.06]" },
  pr_comment: { label: "PR comment", color: "text-accent-blue border-accent-blue/20 bg-accent-blue/[0.06]" },
  issue_comment: { label: "Issue comment", color: "text-amber-400 border-amber-400/20 bg-amber-400/[0.06]" },
  push: { label: "Push", color: "text-accent-green border-accent-green/20 bg-accent-green/[0.06]" },
  ci_failure: { label: "CI fail", color: "text-accent-red border-accent-red/20 bg-accent-red/[0.06]" },
  labeled: { label: "Label", color: "text-teal-400 border-teal-400/20 bg-teal-400/[0.06]" },
  tag_push: { label: "Tag", color: "text-sky-400 border-sky-400/20 bg-sky-400/[0.06]" },
  schedule: { label: "Schedule", color: "text-cyan-400 border-cyan-400/20 bg-cyan-400/[0.06]" },
  webhook: { label: "Webhook", color: "text-orange-400 border-orange-400/20 bg-orange-400/[0.06]" },
  slack_mention: { label: "Slack", color: "text-fuchsia-400 border-fuchsia-400/20 bg-fuchsia-400/[0.06]" },
}

function getInstallationAccountScope(installation: Installation) {
  if (installation.scope_label) return installation.scope_label
  const rawScope = installation.target_type || installation.account_type || "Account"
  if (rawScope.toLowerCase().includes("org")) return "Org"
  if (rawScope.toLowerCase().includes("user")) return "User"
  return rawScope
}

function getInstallationLabel(installation: Installation) {
  return installation.account_login || `Installation ${installation.installation_id}`
}

function getInstallationRepoSummary(installation: Installation) {
  if (installation.repositories.length === 0) {
    return "No synced repos yet"
  }

  if (installation.repositories.length <= 3) {
    return installation.repositories.map((repo) => repo.full_name).join(", ")
  }

  return `${installation.repositories.slice(0, 2).map((repo) => repo.full_name).join(", ")} +${installation.repositories.length - 2} more`
}

function InstallationCombobox({
  installations,
  value,
  onChange,
  emptyMessage = "No installations found.",
}: {
  installations: Installation[]
  value: string
  onChange: (value: string) => void
  emptyMessage?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = installations.find((installation) => String(installation.installation_id) === value) || null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          data-testid="trigger-installation-combobox"
          className="w-full rounded border border-border bg-input px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-border/80"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className={selected ? "truncate" : "text-muted-foreground"}>
                {selected ? getInstallationLabel(selected) : "Select installation..."}
              </div>
              {selected && (
                <div className="truncate text-xs text-muted-foreground mt-0.5">
                  {getInstallationAccountScope(selected)} · {getInstallationRepoSummary(selected)}
                </div>
              )}
            </div>
            <span className="shrink-0 text-muted-foreground">{open ? "▴" : "▾"}</span>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-0">
        <Command>
          <CommandInput placeholder="Search installations or repos..." />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {installations.map((installation) => {
                const scope = getInstallationAccountScope(installation)
                const selectedInstallation = String(installation.installation_id) === value
                return (
                  <CommandItem
                    key={installation.id}
                    value={[
                      getInstallationLabel(installation),
                      scope,
                      installation.repositories.map((repo) => repo.full_name).join(" "),
                    ].join(" ")}
                    onSelect={() => {
                      onChange(String(installation.installation_id))
                      setOpen(false)
                    }}
                    className="items-start py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm">{getInstallationLabel(installation)}</span>
                        <span className="rounded border border-border px-1 py-px font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                          {scope}
                        </span>
                        <span className="rounded border border-border px-1 py-px font-mono text-[9px] text-muted-foreground">
                          {installation.repositories.length} repo{installation.repositories.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] leading-tight text-muted-foreground">
                        {getInstallationRepoSummary(installation)}
                      </div>
                    </div>
                    <span className={`shrink-0 text-xs ${selectedInstallation ? "text-accent-green" : "text-transparent"}`}>
                      ✓
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function InlineTriggerForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { data: installations } = useSWR<Installation[]>("/api/github/installations", fetcher)
  const { data: agents } = useSWR<Agent[]>("/api/agents", fetcher)
  const { data: authData } = useSWR<AuthUserResponse>("/api/auth/user", fetcher)
  const { data: repos } = useSWR<RepoSummary[]>("/api/repos", fetcher)
  const [installationId, setInstallationId] = useState("")
  const [agentId, setAgentId] = useState("")
  const [event, setEvent] = useState<TriggerEvent>("mention")
  const [saving, setSaving] = useState(false)

  const installationCount = installations?.length ?? 0
  const syncedRepoCount = repos?.length ?? 0
  const user = authData?.user ?? null

  if (installations && installationCount === 0) {
    const actionLabel = user?.github_primary_action?.label || (user?.github_app_available ? "Install GitHub App" : "Connect GitHub")
    const actionHref = user?.github_primary_action?.href || "/api/auth/github"
    const currentConnection = user?.github_status_label || (user?.github_connection_mode === "oauth" ? "GitHub OAuth" : user?.github_connected ? "GitHub connected" : "Not connected")

    return (
      <div className="border-b border-border bg-secondary/50 p-4">
        <div className="rounded-lg border border-accent-blue/20 bg-accent-blue/5 p-4">
          <div className="text-sm font-medium text-foreground">Install the GitHub App to create triggers</div>
          <div className="mt-2 text-sm leading-6 text-muted-foreground">
            Triggered agents listen to GitHub webhooks from a GitHub App installation. Synced repos on their own will not appear here until the Mogplex GitHub App is installed on the account or org that owns them.
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
            <div>
              Installations: {user?.github_installation_count ?? 0}
            </div>
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
    )
  }

  const handleCreate = async () => {
    if (!installationId || !agentId || !event) return
    setSaving(true)
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
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to create trigger")
      }
      toast({ title: "Trigger created" })
      onCreated()
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

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
          <option key={o.value} value={o.value}>{o.label}</option>
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
            {a.name}{a.slug ? ` (${a.slug})` : ""}
          </option>
        ))}
      </select>
      {event === "mention" && (
        <div className="rounded border border-border/80 bg-card/60 px-3 py-2 text-xs text-muted-foreground">
          GitHub comments containing <span className="font-medium text-foreground">@mogplex</span> run this trigger.
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded">
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
  )
}

export function TriggersPane() {
  const { data: triggers, mutate: mutateTriggers, isLoading } = useSWR<TriggerWithAgent[]>(
    "/api/triggers",
    fetcher
  )
  const { data: installations, mutate: mutateInstallations } = useSWR<Installation[]>("/api/github/installations", fetcher)
  const { data: authData } = useSWR<AuthUserResponse>("/api/auth/user", fetcher)
  const { data: repos, mutate: mutateRepos } = useSWR<RepoSummary[]>("/api/repos", fetcher)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const realtimeSpecs = useMemo(() => [
    { table: "triggers", filter: "user_id=eq.$USER_ID" },
    { table: "github_installations", filter: "user_id=eq.$USER_ID" },
    { table: "repos", filter: "user_id=eq.$USER_ID" },
    { table: "job_runs" },
    { table: "automation_dispatch_events", filter: "user_id=eq.$USER_ID" },
  ], [])
  const refreshAll = useCallback(
    () => Promise.all([mutateTriggers(), mutateInstallations(), mutateRepos()]),
    [mutateInstallations, mutateRepos, mutateTriggers]
  )

  useRealtimeRouteRefresh({
    channelName: "triggers-pane",
    specs: realtimeSpecs,
    onInvalidate: refreshAll,
  })

  const installationMap = new Map(
    (installations || []).map((i) => [i.installation_id, i])
  )

  const toggleEnabled = async (trigger: TriggerWithAgent) => {
    setTogglingId(trigger.id)
    try {
      await fetch("/api/triggers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: trigger.id, enabled: !trigger.enabled }),
      })
      await mutateTriggers()
    } catch {
      // SWR will refetch
    } finally {
      setTogglingId(null)
    }
  }

  const deleteTrigger = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/triggers?id=${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete")
      await mutateTriggers()
      toast({ title: "Trigger deleted" })
    } catch {
      toast({ title: "Error", description: "Failed to delete trigger", variant: "destructive" })
    } finally {
      setDeletingId(null)
    }
  }

  if (isLoading) {
    return <div className="flex-1 p-3 text-xs text-muted-foreground">Loading triggers...</div>
  }

  const triggerList = triggers || []
  const installationCount = installations?.length ?? 0
  const syncedRepoCount = repos?.length ?? 0
  const user = authData?.user ?? null

  // Group by installation
  const grouped = new Map<number, TriggerWithAgent[]>()
  for (const t of triggerList) {
    const existing = grouped.get(t.installation_id) || []
    existing.push(t)
    grouped.set(t.installation_id, existing)
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
          onCreated={() => { setShowForm(false); void refreshAll() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="flex-1 overflow-auto">
        {triggerList.length === 0 && !showForm && (
          <div className="flex h-full items-center justify-center p-6">
            <div
              data-testid="triggers-empty-state"
              className="w-full max-w-3xl rounded-lg border border-border bg-secondary/20 p-6 shadow-sm"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent-blue/80">
                    Automation
                  </div>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                    Create your first triggered agent
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Triggered agents wake up when something important happens in GitHub, like a direct mention, a pull request opening, an issue comment, or a failing CI run.
                  </p>
                </div>
                <div className="rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-4 py-3 text-left md:max-w-xs">
                  <div className="text-xs font-medium uppercase tracking-wide text-accent-blue">What you need</div>
                  <div className="mt-2 text-sm leading-6 text-muted-foreground">
                    A connected GitHub App installation and at least one agent ready to respond.
                  </div>
                </div>
              </div>

              {installationCount === 0 && (
                <div className="mt-5 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
                  <div className="text-sm font-medium text-foreground">No GitHub App installations found</div>
                  <div className="mt-1 text-sm leading-6 text-muted-foreground">
                    {syncedRepoCount > 0
                      ? `You have ${syncedRepoCount} synced repo${syncedRepoCount === 1 ? "" : "s"}, but triggers only work for repos covered by an installed GitHub App.`
                      : "Triggers only work for repos covered by an installed GitHub App."}
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {user?.github_status_detail
                      || (user?.github_connection_mode === "oauth"
                        ? "You are currently connected through GitHub OAuth."
                        : user?.github_connected
                          ? "GitHub is connected, but no app installations are available yet."
                          : "Connect GitHub and install the app to start creating triggers.")}
                  </div>
                </div>
              )}

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {[
                  {
                    step: "01",
                    title: "Choose an installation",
                    description: "Pick the GitHub account scope where this automation should listen.",
                  },
                  {
                    step: "02",
                    title: "Select the event",
                    description: "Decide what should wake the agent up, from mentions to CI failures.",
                  },
                  {
                    step: "03",
                    title: "Assign an agent",
                    description: "Route the event to the agent that should triage, answer, or take action.",
                  },
                ].map((item) => (
                  <div key={item.step} className="rounded-lg border border-border bg-card/70 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      {item.step}
                    </div>
                    <div className="mt-2 text-sm font-medium text-foreground">{item.title}</div>
                    <div className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                {installationCount > 0 ? (
                  <button
                    onClick={() => setShowForm(true)}
                    className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    Create first trigger
                  </button>
                ) : (
                  <a
                    href={user?.github_primary_action?.href || "/api/auth/github"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    {user?.github_primary_action?.label || (user?.github_app_available ? "Install GitHub App" : "Connect GitHub")}
                  </a>
                )}
                <div className="text-sm text-muted-foreground">
                  {installationCount > 0
                    ? `${installationCount} installation${installationCount === 1 ? "" : "s"} available to use`
                    : "No GitHub App installations detected yet"}
                </div>
              </div>
            </div>
          </div>
        )}
        {Array.from(grouped.entries()).map(([installId, items]) => {
          const inst = installationMap.get(installId)
          return (
            <div key={installId}>
              {grouped.size > 1 && (
                <div className="px-4 py-2 text-xs text-muted-foreground bg-secondary/30 border-b border-border-dim">
                  {inst
                    ? `${getInstallationLabel(inst)} · ${getInstallationAccountScope(inst)} · ${getInstallationRepoSummary(inst)}`
                    : `Installation ${installId}`}
                </div>
              )}
              {items.map((trigger) => {
                const badge = EVENT_BADGES[trigger.event]
                return (
                  <div
                    key={trigger.id}
                    className="flex items-center gap-3 px-4 py-3 border-b border-border-dim"
                  >
                    <button
                      onClick={() => void toggleEnabled(trigger)}
                      disabled={togglingId === trigger.id}
                      className={`w-8 h-4 rounded-full relative transition-colors shrink-0 ${
                        trigger.enabled ? "bg-accent-green" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                          trigger.enabled ? "left-[18px]" : "left-0.5"
                        }`}
                      />
                    </button>
                    <span className={`font-mono text-[11px] px-2 py-0.5 rounded border shrink-0 ${badge.color}`}>
                      {badge.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-foreground">
                        {trigger.agents?.name || "Unknown agent"}
                        {trigger.agents?.slug && (
                          <span className="text-muted-foreground ml-1">/{trigger.agents.slug}</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          Last run: {trigger.last_run_status || "never"}
                          {trigger.last_run_started_at ? ` · ${new Date(trigger.last_run_started_at).toLocaleString()}` : ""}
                        </span>
                        {typeof trigger.failed_24h === "number" && trigger.failed_24h > 0 && (
                          <span className="rounded border border-accent-red/20 bg-accent-red/5 px-1.5 py-px text-accent-red">
                            {trigger.failed_24h} failed / 24h
                          </span>
                        )}
                        {typeof trigger.running_count === "number" && trigger.running_count > 0 && (
                          <span className="rounded border border-accent-blue/20 bg-accent-blue/5 px-1.5 py-px text-accent-blue">
                            {trigger.running_count} running
                          </span>
                        )}
                        {typeof trigger.pending_count === "number" && trigger.pending_count > 0 && (
                          <span className="rounded border border-accent-amber/20 bg-accent-amber/5 px-1.5 py-px text-accent-amber">
                            {trigger.pending_count} pending
                          </span>
                        )}
                        {typeof trigger.suppressed_24h === "number" && trigger.suppressed_24h > 0 && (
                          <span className="rounded border border-accent-red/20 bg-accent-red/5 px-1.5 py-px text-accent-red">
                            {trigger.suppressed_24h} suppressed / 24h
                          </span>
                        )}
                        {typeof trigger.deferred_24h === "number" && trigger.deferred_24h > 0 && (
                          <span className="rounded border border-accent-amber/20 bg-accent-amber/5 px-1.5 py-px text-accent-amber">
                            {trigger.deferred_24h} deferred / 24h
                          </span>
                        )}
                        {trigger.last_pressure_reason && (
                          <span className="truncate text-accent-amber" title={trigger.last_pressure_reason}>
                            Pressure: {trigger.last_pressure_reason}
                          </span>
                        )}
                      </div>
                    </div>
                    {trigger.is_default && (
                      <span className="text-[10px] px-1.5 py-px rounded bg-purple-400/10 text-purple-400 border border-purple-400/20 shrink-0">
                        default
                      </span>
                    )}
                    <button
                      onClick={() => void deleteTrigger(trigger.id)}
                      disabled={deletingId === trigger.id}
                      className="text-muted-foreground hover:text-accent-red disabled:opacity-50 text-sm shrink-0"
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
