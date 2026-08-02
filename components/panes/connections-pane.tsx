"use client"
import { useCallback, useMemo, useState } from "react"
import useSWR from "swr"
import { useSessionsStore } from "@/hooks/use-sessions"
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh"
import { MAX_MCP_CONNECTIONS } from "@/lib/connections/constants"
import {
  CONNECTION_PRESETS,
  CONNECTION_PRESET_MANUAL_HINT,
  getConnectionAuthorizationPath,
  getConnectionPreset,
  getConnectionPresetAuthorizationDescription,
  usesManagedConnectionAuth,
} from "@/lib/connections/presets"
import type { ConnectionPreset } from "@/lib/connections/presets"
import {
  getConnectionDisplayState,
  getPresetConnectionState,
} from "@/lib/connections/presentation"
import {
  type ConnectionHealthStatus,
  formatConnectionLastTested,
  getConnectionStatusDetail,
  getConnectionStatusLabel,
  getConnectionStatusTone,
} from "@/lib/connections/status"
import { toast } from "@/hooks/use-toast"
import type { Connection, ConnectionOverride } from "@/lib/types"
import { SlackSection } from "@/components/connections/slack-section"

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`API error: ${r.status}`)
  return r.json()
}

function scrollToConnectionRow(connectionId: string | null | undefined) {
  if (!connectionId) return
  document
    .querySelector<HTMLElement>(`[data-connection-id="${connectionId}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" })
}

type ResolvedData = {
  connections: Connection[]
  overrides: ConnectionOverride[]
  resolved_mcp_count?: number
}

type PresetStatus = {
  presetId: string
  type: "testing" | "success" | "error"
  message: string
}

const EMPTY_CONNECTIONS: Connection[] = []
const EMPTY_OVERRIDES: ConnectionOverride[] = []

const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  rest_api: { label: "REST", color: "text-accent-blue border-accent-blue/20 bg-accent-blue/[0.06]" },
  mcp_server: { label: "MCP", color: "text-purple-400 border-purple-400/20 bg-purple-400/[0.06]" },
}

const SCOPE_BADGES: Record<string, { label: string; color: string }> = {
  global: { label: "global", color: "text-muted-foreground border-border-dim bg-background" },
  project: { label: "project", color: "text-amber-400 border-amber-400/20 bg-amber-400/[0.06]" },
}

const AUTH_OPTIONS = [
  { value: "none", label: "None" },
  { value: "api_key", label: "API Key" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
  { value: "oauth", label: "OAuth" },
]

function InlineAddForm({ repoId, onCreated, onCancel, mcpCount }: {
  repoId?: string
  onCreated: () => void
  onCancel: () => void
  mcpCount: number
}) {
  const [type, setType] = useState<"rest_api" | "mcp_server">("rest_api")
  const [scope, setScope] = useState<"global" | "project">(repoId ? "project" : "global")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [authType, setAuthType] = useState("none")
  const [mcpUrl, setMcpUrl] = useState("")
  const [mcpTransport, setMcpTransport] = useState<"http" | "sse">("http")
  const [credentials, setCredentials] = useState("")
  const [oauthClientId, setOauthClientId] = useState("")
  const [oauthAuthorizeUrl, setOauthAuthorizeUrl] = useState("")
  const [oauthTokenUrl, setOauthTokenUrl] = useState("")
  const [oauthScopes, setOauthScopes] = useState("")
  const [saving, setSaving] = useState(false)

  const mcpAtCap = mcpCount >= MAX_MCP_CONNECTIONS

  const handleCreate = async () => {
    if (!name) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name,
        type,
        description: description || undefined,
        scope,
        repo_id: scope === "project" ? repoId : undefined,
        auth_type: authType,
      }

      if (type === "rest_api") {
        body.base_url = baseUrl
      } else {
        body.mcp_url = mcpUrl
        body.mcp_transport = mcpTransport
      }

      if (authType === "oauth") {
        body.oauth_client_id = oauthClientId
        body.oauth_authorize_url = oauthAuthorizeUrl
        body.oauth_token_url = oauthTokenUrl
        body.oauth_scopes = oauthScopes || undefined
        // Store client_secret in credentials JSON
        if (credentials) {
          body.credentials = JSON.stringify({ client_secret: credentials })
        }
      } else if (authType !== "none" && credentials) {
        body.credentials = credentials
      }

      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to create connection")
      }
      toast({ title: "Connection created" })
      onCreated()
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-b border-border bg-secondary/50 p-3 space-y-2">
      <div className="flex gap-2">
        <button
          onClick={() => setType("rest_api")}
          className={`flex-1 px-2 py-1.5 text-[11px] rounded border ${type === "rest_api" ? "border-accent-blue bg-accent-blue/10 text-accent-blue" : "border-border text-muted-foreground"}`}
        >
          REST API
        </button>
        <button
          onClick={() => !mcpAtCap && setType("mcp_server")}
          disabled={mcpAtCap}
          className={`flex-1 px-2 py-1.5 text-[11px] rounded border ${type === "mcp_server" ? "border-purple-400 bg-purple-400/10 text-purple-400" : "border-border text-muted-foreground"} disabled:opacity-40`}
          title={mcpAtCap ? `Max ${MAX_MCP_CONNECTIONS} MCPs reached` : undefined}
        >
          MCP Server{mcpAtCap ? " (at cap)" : ""}
        </button>
      </div>

      {repoId && (
        <div className="flex gap-2">
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
            <input type="radio" name="scope" checked={scope === "global"} onChange={() => setScope("global")} className="w-3 h-3" />
            Global
          </label>
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
            <input type="radio" name="scope" checked={scope === "project"} onChange={() => setScope("project")} className="w-3 h-3" />
            This Project
          </label>
        </div>
      )}

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Connection name"
        className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
      />

      {type === "rest_api" ? (
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="Base URL (e.g. https://api.example.com)"
          className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
        />
      ) : (
        <>
          <input
            value={mcpUrl}
            onChange={(e) => setMcpUrl(e.target.value)}
            placeholder="MCP Server URL"
            className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
          />
          <select
            value={mcpTransport}
            onChange={(e) => setMcpTransport(e.target.value as "http" | "sse")}
            className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
          >
            <option value="http">HTTP</option>
            <option value="sse">SSE</option>
          </select>
        </>
      )}

      <select
        value={authType}
        onChange={(e) => setAuthType(e.target.value)}
        className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
      >
        {AUTH_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {authType === "oauth" ? (
        <>
          <input value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)} placeholder="Client ID" className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded" />
          <input value={credentials} onChange={(e) => setCredentials(e.target.value)} placeholder="Client Secret" type="password" className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded" />
          <input value={oauthAuthorizeUrl} onChange={(e) => setOauthAuthorizeUrl(e.target.value)} placeholder="Authorize URL" className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded" />
          <input value={oauthTokenUrl} onChange={(e) => setOauthTokenUrl(e.target.value)} placeholder="Token URL" className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded" />
          <input value={oauthScopes} onChange={(e) => setOauthScopes(e.target.value)} placeholder="Scopes (space-separated, optional)" className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded" />
        </>
      ) : authType !== "none" ? (
        <input
          value={credentials}
          onChange={(e) => setCredentials(e.target.value)}
          placeholder={authType === "api_key" ? "API Key" : authType === "basic" ? "base64 user:pass" : "Token"}
          type="password"
          className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
        />
      ) : null}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded">
          Cancel
        </button>
        <button
          onClick={() => void handleCreate()}
          disabled={!name || saving}
          className="px-3 py-1.5 text-[11px] bg-primary text-primary-foreground rounded disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create"}
        </button>
      </div>
    </div>
  )
}

export function ConnectionsPane() {
  const activeRepo = useSessionsStore((s) => {
    const session = s.sessions.find((sess) => sess.id === s.activeSessionId) || s.sessions[0]
    return session?.activeRepo ?? null
  })

  const apiUrl = activeRepo?.id
    ? `/api/repos/${activeRepo.id}/connections`
    : "/api/connections"

  const { data, mutate, isLoading } = useSWR<ResolvedData | { connections: Connection[] }>(
    apiUrl,
    fetcher
  )

  const [showForm, setShowForm] = useState(false)
  const [activePreset, setActivePreset] = useState<ConnectionPreset | null>(null)
  const [presetCredential, setPresetCredential] = useState("")
  const [presetMcpUrl, setPresetMcpUrl] = useState("")
  const [presetStatus, setPresetStatus] = useState<PresetStatus | null>(null)
  const [presetSaving, setPresetSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)

  const connections = data?.connections ?? EMPTY_CONNECTIONS
  const overrides = "overrides" in (data ?? {}) ? (data as ResolvedData).overrides : EMPTY_OVERRIDES

  const realtimeSpecs = useMemo(() => {
    const specs = [{ table: "connections", filter: "user_id=eq.$USER_ID" }]
    if (activeRepo?.id) {
      specs.push({ table: "repo_connection_overrides", filter: `repo_id=eq.${activeRepo.id}` })
    }
    return specs
  }, [activeRepo?.id])

  const refreshConnections = useCallback(() => mutate(), [mutate])
  useRealtimeRouteRefresh({
    channelName: `connections-pane:${activeRepo?.id ?? "global"}`,
    specs: realtimeSpecs,
    onInvalidate: refreshConnections,
  })

  const excludedSet = useMemo(() => new Set(
    overrides.filter(o => o.excluded && o.connection_id).map(o => o.connection_id!)
  ), [overrides])

  const presetStates = useMemo(() => Object.fromEntries(
    CONNECTION_PRESETS.map((preset) => [
      preset.id,
      getPresetConnectionState(
        {
          presetId: preset.id,
          usesManagedConnectionAuth: usesManagedConnectionAuth(preset),
        },
        connections,
        excludedSet
      ),
    ])
  ) as Record<string, ReturnType<typeof getPresetConnectionState>>, [connections, excludedSet])

  const configuredPresetIds = new Set(
    Object.entries(presetStates)
      .filter(([, state]) => !state.isAddable)
      .map(([presetId]) => presetId)
  )

  const resolvedMcpCount = "resolved_mcp_count" in (data ?? {})
    ? (data as ResolvedData).resolved_mcp_count
    : undefined

  const mcpCount = typeof resolvedMcpCount === "number"
    ? resolvedMcpCount
    : connections.filter(c => c.type === "mcp_server").length

  const addPresetConnection = async (preset: ConnectionPreset) => {
    const requiresCredential = preset.auth_fields.length > 0
    if (preset.mcp_url_field && !presetMcpUrl.trim()) return
    if (requiresCredential && !presetCredential.trim()) return
    setPresetSaving(true)
    setPresetStatus(null)
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: preset.name,
          type: "mcp_server",
          mcp_url: preset.mcp_url_field ? presetMcpUrl.trim() : preset.mcp_url,
          mcp_transport: preset.mcp_transport,
          auth_type: preset.auth_type,
          ...(requiresCredential ? { credentials: presetCredential.trim() } : {}),
          description: preset.description,
          source_preset: preset.id,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as {
          error?: string
          connection?: Connection
        }
        if (res.status === 409) {
          await mutate()
          if (preset.auth_type === "oauth" && data.connection?.id) {
            initiateOAuth(data.connection)
            return
          }
          setActivePreset(null)
          setPresetCredential("")
          setPresetMcpUrl("")
          setPresetStatus({
            presetId: preset.id,
            type: "success",
            message: data.error || "Already connected",
          })
          scrollToConnectionRow((data.connection as Connection | undefined)?.id)
          return
        }
        setPresetStatus({
          presetId: preset.id,
          type: "error",
          message: data.error || "Failed to create connection",
        })
        return
      }
      const { connection } = await res.json() as { connection?: Connection }
      setActivePreset(null)
      setPresetCredential("")
      setPresetMcpUrl("")
      await mutate()

      if (preset.auth_type === "oauth" && connection?.id) {
        initiateOAuth(connection)
        return
      }

      if (connection?.id) {
        setPresetStatus({ presetId: preset.id, type: "testing", message: "Testing..." })
        const testRes = await fetch(`/api/connections/${connection.id}/test`, { method: "POST" })
        const testData = await testRes.json().catch(() => ({})) as {
          healthy?: boolean
          toolCount?: number
          error?: string
          code?: string
        }
        await mutate()
        setPresetStatus({
          presetId: preset.id,
          type: testRes.ok && testData.healthy ? "success" : "error",
          message: testData.healthy
            ? `Connected${testData.toolCount != null ? ` · ${testData.toolCount} tools` : ""}`
            : testData.error || "Connection test failed",
        })
      } else {
        setPresetStatus({ presetId: preset.id, type: "success", message: "Connected" })
      }

      toast({ title: `${preset.name} connected` })
    } catch (e) {
      const message = (e as Error).message || "Network error"
      setPresetStatus({ presetId: preset.id, type: "error", message })
      toast({ title: "Error", description: message, variant: "destructive" })
    } finally {
      setPresetSaving(false)
    }
  }

  const toggleExclude = async (conn: Connection) => {
    if (!activeRepo?.id) return
    setTogglingId(conn.id)
    try {
      const isExcluded = excludedSet.has(conn.id)
      const res = await fetch(`/api/repos/${activeRepo.id}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: conn.id, excluded: !isExcluded }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to update override")
      }
      await mutate()
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" })
    } finally {
      setTogglingId(null)
    }
  }

  const toggleEnabled = async (conn: Connection) => {
    setTogglingId(conn.id)
    try {
      const res = await fetch("/api/connections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: conn.id, is_enabled: !conn.is_enabled }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to toggle connection")
      }
      await mutate()
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" })
    } finally {
      setTogglingId(null)
    }
  }

  const deleteConnection = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch("/api/connections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to delete connection")
      }
      await mutate()
      toast({ title: "Connection deleted" })
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" })
    } finally {
      setDeletingId(null)
    }
  }

  const testConnection = async (conn: Connection) => {
    setTestingId(conn.id)
    try {
      const res = await fetch(`/api/connections/${conn.id}/test`, { method: "POST" })
      const data = await res.json().catch(() => ({})) as {
        healthy?: boolean
        status?: ConnectionHealthStatus
        summary?: string
        error?: string
      }
      if (!res.ok) {
        throw new Error(data.error || "Connection test failed")
      }
      if (data.healthy) {
        toast({ title: data.summary || "Connection healthy" })
      } else {
        toast({ title: getConnectionStatusLabel(data.status || "error"), description: data.summary || data.error, variant: "destructive" })
      }
      await mutate()
    } catch {
      toast({ title: "Test failed", variant: "destructive" })
    } finally {
      setTestingId(null)
    }
  }

  const initiateOAuth = (conn: Pick<Connection, "id" | "source_preset">) => {
    window.location.href = getConnectionAuthorizationPath({
      connectionId: conn.id,
      sourcePreset: conn.source_preset,
    })
  }

  if (isLoading) {
    return <div className="flex-1 p-3 text-xs text-muted-foreground">Loading connections...</div>
  }

  const globalConns = connections.filter(c => c.scope === "global")
  const projectConns = connections.filter(c => c.scope === "project")

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-dim">
        <span className="text-[11px] text-muted-foreground">
          {connections.length} connection{connections.length !== 1 ? "s" : ""}
          <span className="ml-2 text-purple-400">{mcpCount}/{MAX_MCP_CONNECTIONS} MCPs</span>
        </span>
        <button
          onClick={() => setShowForm((f) => !f)}
          className="px-2.5 py-1 text-[11px] text-accent-blue hover:bg-accent-blue/10 rounded border border-accent-blue/20"
        >
          {showForm ? "Close form" : "Add connection"}
        </button>
      </div>

      {showForm && (
        <InlineAddForm
          repoId={activeRepo?.id}
          mcpCount={mcpCount}
          onCreated={() => { setShowForm(false); void mutate() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="px-3 py-2 border-b border-border-dim space-y-1.5">
        <div className="text-[11px] text-muted-foreground font-medium">Slack</div>
        <SlackSection />
      </div>

      <div className="px-3 py-1.5 border-b border-border-dim space-y-1.5">
        <div
          data-testid="connections-preset-manual-hint"
          className="text-[11px] text-muted-foreground"
        >
          {CONNECTION_PRESET_MANUAL_HINT}
        </div>
        <div className="flex flex-wrap gap-1">
          {CONNECTION_PRESETS.map(preset => {
            const presetState = presetStates[preset.id]
            const isConfigured = configuredPresetIds.has(preset.id)
            const isActive = activePreset?.id === preset.id
            const status = presetStatus?.presetId === preset.id ? presetStatus : null
            return (
              <div key={preset.id} data-testid={`connections-preset-${preset.id}`} className="space-y-1">
                <button
                  onClick={() => {
                    if (isConfigured) {
                      scrollToConnectionRow(presetState.connection?.id)
                      return
                    }
                    setActivePreset(isActive ? null : preset)
                    setPresetCredential("")
                    setPresetMcpUrl("")
                    setPresetStatus(null)
                  }}
                  className={`px-2 py-1 text-[11px] rounded border ${
                    isConfigured
                      ? presetState.label === "Connected"
                        ? "border-accent-green/20 text-accent-green bg-accent-green/[0.06]"
                        : "border-amber-400/20 text-amber-400 bg-amber-400/[0.06]"
                      : isActive
                      ? "border-purple-400 text-purple-400 bg-purple-400/10"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                  title={isConfigured
                    ? `${preset.name} ${presetState.label.toLowerCase()}`
                    : preset.description}
                >
                  {isConfigured ? `${preset.name} · ${presetState.label}` : `+ ${preset.name}`}
                </button>
                {isConfigured && presetState.detail && (
                  <div className="text-[11px] leading-tight text-amber-400">
                    {presetState.detail}
                  </div>
                )}
                {status && !isActive && (
                  <div className={`text-[11px] leading-tight ${
                    status.type === "success"
                      ? "text-accent-green"
                      : status.type === "error"
                      ? "text-red-400"
                      : "text-muted-foreground"
                  }`}>
                    {status.message}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {activePreset && (
          <div className="space-y-1.5">
            <div className="flex gap-1.5 items-center">
              {activePreset.mcp_url_field ? (
                <div className="flex-1 space-y-1">
                  <div className="text-[11px] text-muted-foreground">
                    Paste the full MCP server URL from Zapier&apos;s Connect tab. This URL is secret and can be rotated from Zapier later.
                  </div>
                  <input
                    type={activePreset.mcp_url_field.secret ? "password" : "text"}
                    value={presetMcpUrl}
                    onChange={e => setPresetMcpUrl(e.target.value)}
                    placeholder={activePreset.mcp_url_field.placeholder}
                    className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
                    autoFocus
                  />
                </div>
              ) : activePreset.auth_type === "oauth" ? (
                <div className="flex-1 text-[11px] text-muted-foreground">
                  {getConnectionPresetAuthorizationDescription(activePreset)}
                </div>
              ) : (
                <input
                  type="password"
                  value={presetCredential}
                  onChange={e => setPresetCredential(e.target.value)}
                  placeholder={activePreset.auth_fields[0]?.placeholder ?? "Credential"}
                  className="flex-1 px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
                  autoFocus
                />
              )}
              <a href={activePreset.docs_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted-foreground hover:text-foreground shrink-0">
                docs
              </a>
              <button
                onClick={() => void addPresetConnection(activePreset)}
                disabled={(!!activePreset.mcp_url_field && !presetMcpUrl.trim()) || ((activePreset.auth_fields.length > 0 && !presetCredential.trim()) || presetSaving)}
                className="px-3 py-1.5 text-[11px] bg-primary text-primary-foreground rounded disabled:opacity-50 shrink-0"
              >
                {presetSaving ? "..." : activePreset.auth_type === "oauth" ? "Connect" : "Add"}
              </button>
            </div>
            {presetStatus?.presetId === activePreset.id && presetStatus.type === "error" && (
              <div className="text-[11px] text-red-400">{presetStatus.message}</div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {connections.length === 0 && !showForm && (
          <div className="flex items-center justify-center h-full p-4 text-xs text-muted-foreground">
            No connections configured. Add REST APIs or MCP servers to extend agent capabilities.
          </div>
        )}

        {globalConns.length > 0 && (
          <>
            <div className="px-3 py-2 text-[11px] text-muted-foreground bg-secondary/30 border-b border-border-dim">
              Global
            </div>
            {globalConns.map((conn) => (
              <ConnectionRow
                key={conn.id}
                conn={conn}
                isExcluded={excludedSet.has(conn.id)}
                hasRepo={!!activeRepo?.id}
                togglingId={togglingId}
                deletingId={deletingId}
                testingId={testingId}
                onToggleEnabled={() => void toggleEnabled(conn)}
                onToggleExclude={() => void toggleExclude(conn)}
                onDelete={() => void deleteConnection(conn.id)}
                onTest={() => void testConnection(conn)}
                onOAuth={() => initiateOAuth(conn)}
              />
            ))}
          </>
        )}

        {projectConns.length > 0 && (
          <>
            <div className="px-3 py-1 text-[10px] text-muted-foreground bg-secondary/30 border-b border-border-dim">
              Project
            </div>
            {projectConns.map((conn) => (
              <ConnectionRow
                key={conn.id}
                conn={conn}
                isExcluded={false}
                hasRepo={!!activeRepo?.id}
                togglingId={togglingId}
                deletingId={deletingId}
                testingId={testingId}
                onToggleEnabled={() => void toggleEnabled(conn)}
                onToggleExclude={() => {}}
                onDelete={() => void deleteConnection(conn.id)}
                onTest={() => void testConnection(conn)}
                onOAuth={() => initiateOAuth(conn)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function ConnectionRow({ conn, isExcluded, hasRepo, togglingId, deletingId, testingId, onToggleEnabled, onToggleExclude, onDelete, onTest, onOAuth }: {
  conn: Connection
  isExcluded: boolean
  hasRepo: boolean
  togglingId: string | null
  deletingId: string | null
  testingId: string | null
  onToggleEnabled: () => void
  onToggleExclude: () => void
  onDelete: () => void
  onTest: () => void
  onOAuth: () => void
}) {
  const typeBadge = TYPE_BADGES[conn.type] ?? TYPE_BADGES.rest_api
  const scopeBadge = SCOPE_BADGES[conn.scope] ?? SCOPE_BADGES.global
  const preset = getConnectionPreset(conn.source_preset)
  const displayState = getConnectionDisplayState(
    {
      ...conn,
      needsManagedAuthReconnect:
        usesManagedConnectionAuth(preset) && conn.auth_type !== "oauth",
    },
    new Set(isExcluded ? [conn.id] : [])
  )

  return (
    <div
      data-connection-id={conn.id}
      className={`flex items-center gap-2 px-3 py-2 border-b border-border-dim ${displayState.rowMuted ? "opacity-55" : ""}`}
    >
      <button
        onClick={onToggleEnabled}
        disabled={togglingId === conn.id}
        className={`w-8 h-4 rounded-full relative transition-colors shrink-0 ${
          conn.is_enabled ? "bg-accent-green" : "bg-muted"
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
            conn.is_enabled ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>

      <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${typeBadge.color}`}>
        {typeBadge.label}
      </span>

      <span className="text-[11px] text-foreground flex-1 truncate">
        <span className="block truncate">{conn.name}</span>
        <span className="block text-[10px] text-muted-foreground truncate">
          {conn.description || getConnectionStatusDetail(conn)}
        </span>
        <span className="block text-[10px] text-muted-foreground truncate">
          {formatConnectionLastTested(conn.last_tested_at)}
        </span>
      </span>

      {preset && (
        <span className="font-mono text-[9px] px-1 py-px rounded border shrink-0 text-purple-300 border-purple-400/20 bg-purple-400/[0.06]">
          preset · {preset.name}
        </span>
      )}

      <span className={`font-mono text-[9px] px-1 py-px rounded border shrink-0 ${scopeBadge.color}`}>
        {scopeBadge.label}
      </span>

      <span className={`font-mono text-[9px] shrink-0 ${getConnectionStatusTone(conn.health_status)}`}>
        {getConnectionStatusLabel(conn.health_status)}
      </span>

      {displayState.isDisabled && (
        <span className="font-mono text-[9px] px-1 py-px rounded border shrink-0 text-amber-400 border-amber-400/20 bg-amber-400/[0.06]">
          disabled
        </span>
      )}

      {displayState.isExcluded && (
        <span className="font-mono text-[9px] px-1 py-px rounded border shrink-0 text-accent-red border-accent-red/20 bg-accent-red/[0.06]">
          excluded
        </span>
      )}

      {displayState.oauthActionLabel && (
        <button
          onClick={onOAuth}
          className="px-1.5 py-0.5 text-[10px] text-amber-400 border border-amber-400/20 rounded hover:bg-amber-400/10"
        >
          {displayState.oauthActionLabel}
        </button>
      )}

      {hasRepo && conn.scope === "global" && (
        <button
          onClick={onToggleExclude}
          disabled={togglingId === conn.id}
          className={`text-[9px] px-1 py-px rounded border shrink-0 ${
            isExcluded
              ? "text-accent-red border-accent-red/20 hover:bg-accent-red/10"
              : "text-muted-foreground border-border-dim hover:bg-muted"
          }`}
          title={isExcluded ? "Include in project" : "Exclude from project"}
        >
          {isExcluded ? "excluded" : "exclude"}
        </button>
      )}

      <button
        onClick={onTest}
        disabled={testingId === conn.id}
        className="text-muted-foreground hover:text-foreground disabled:opacity-50 text-[10px] shrink-0"
        title="Test connection"
      >
        {testingId === conn.id ? "..." : "test"}
      </button>

      <button
        onClick={onDelete}
        disabled={deletingId === conn.id}
        className="text-muted-foreground hover:text-accent-red disabled:opacity-50 text-xs shrink-0"
        title="Delete"
      >
        ×
      </button>
    </div>
  )
}
