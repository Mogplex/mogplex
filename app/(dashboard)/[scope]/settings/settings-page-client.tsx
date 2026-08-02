"use client"
import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import useSWR from "swr"
import { useUser } from "@/hooks/use-user"
import type { Connection } from "@/lib/types"
import { fetchJsonArray, fetchJsonObject } from "@/lib/client-fetch"
import { ModelsSection } from "@/components/library/models-section"
import { TeamSettingsClient } from "@/components/settings/team-settings-client"
import { TeamsListSection } from "@/components/settings/teams-list-section"
import { CliApiKeysSection } from "@/components/settings/cli-api-keys-section"
import { SlackInstallToast } from "@/components/connections/slack-install-toast"
import { SlackSection } from "@/components/connections/slack-section"
import { SlackFill } from "@/components/settings/icons"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
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
  formatConnectionLastTested,
  getConnectionStatusDetail,
  getConnectionStatusLabel,
  getConnectionStatusTone,
} from "@/lib/connections/status"
import { trackActivation } from "@/lib/activation-tracking"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getPresetIcon } from "@/components/settings/preset-icons"
import type { ScopeContext } from "@/lib/scope-context"

type GithubInstallationView = {
  id: string
  installation_id: number
  account_login: string | null
  account_type: string | null
  target_type: string | null
  repository_count: number
  synced_repo_count: number
  scope_label: string
  manage_url: string | null
  repositories: Array<{
    id: string
    full_name: string
  }>
}

type GithubOwnerTarget = {
  login: string
  kind: "personal" | "org"
  github_installation_id: number | null
  scope_label: string
  source: "oauth" | "installation" | "oauth+installation"
}

function scrollToConnectionRow(connectionId: string | null | undefined) {
  if (!connectionId) return
  document
    .querySelector<HTMLElement>(`[data-connection-id="${connectionId}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" })
}

const PROVIDER_META: Record<string, { label: string; description: string; placeholder: string; masked: string }> = {
  ai_gateway: {
    label: "AI Gateway",
    description: "Use your own Vercel AI Gateway key so model usage is billed to your gateway account.",
    placeholder: "Paste your AI Gateway key",
    masked: "gateway key saved",
  },
  anthropic: { label: "Anthropic", description: "Claude Code CLI", placeholder: "sk-ant-...", masked: "sk-ant-...****" },
  openai: { label: "OpenAI", description: "Codex CLI", placeholder: "sk-...", masked: "sk-...****" },
  openrouter: {
    label: "OpenRouter",
    description: "Route inference through OpenRouter models with your own key.",
    placeholder: "sk-or-...",
    masked: "sk-or-...****",
  },
}

const CONNECTION_AUTH_OPTIONS = [
  { value: "none", label: "No Auth" },
  { value: "bearer", label: "Bearer Token" },
  { value: "api_key", label: "API Key" },
  { value: "basic", label: "Basic Auth" },
] as const

const SETTINGS_TABS = ["account", "teams", "connections", "keys", "models"] as const
type SettingsTab = (typeof SETTINGS_TABS)[number]
const SETTINGS_TAB_SET: ReadonlySet<string> = new Set(SETTINGS_TABS)

const KEYS_SUB_TABS = ["api", "cli"] as const
type KeysSubTab = (typeof KEYS_SUB_TABS)[number]
const KEYS_SUB_TAB_SET: ReadonlySet<string> = new Set(KEYS_SUB_TABS)

const LEGACY_HASH_TO_TAB: Record<string, SettingsTab> = {
  models: "models",
  connections: "connections",
}

const INITIAL_CONNECTION_FORM = {
  type: "rest_api" as "rest_api" | "mcp_server",
  name: "",
  base_url: "",
  auth_type: "none",
  auth_header: "Authorization",
  mcp_transport: "http" as "sse" | "http",
  mcp_url: "",
  credentials: "",
  description: "",
}

function getDefaultAuthHeader(authType: string) {
  return authType === "api_key" ? "X-API-Key" : "Authorization"
}

type VerifyResult = {
  key_stored: boolean
  key_valid: boolean | null
  key_error?: string
  service: string
  harness?: string
  package?: string
  binary?: string
}

type SettingsView = {
  default_model?: string | null
  theme?: string | null
}

function ApiKeysSection({ platformAiEnabled }: { platformAiEnabled: boolean | null }) {
  const { data, mutate } = useSWR<{ keys: { provider: string; created_at: string }[] }>(
    "/api/settings/keys",
    (url: string) => fetchJsonObject<{ keys: { provider: string; created_at: string }[] }>(url, "Failed to load API keys"),
  )
  const keys = data?.keys || []
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [verifyResults, setVerifyResults] = useState<Record<string, VerifyResult>>({})

  const handleVerify = async (provider: string) => {
    setVerifying(provider)
    setKeyError(null)
    try {
      const res = await fetch("/api/settings/keys/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      })
      const result = await res.json()
      if (!res.ok) {
        setKeyError(result.error || "Verification failed")
      } else {
        setVerifyResults((prev) => ({ ...prev, [provider]: result }))
      }
    } catch {
      setKeyError("Network error during verification")
    } finally {
      setVerifying(null)
    }
  }

  const configuredProviders = useMemo(() => new Set((data?.keys || []).map((k) => k.provider)), [data?.keys])

  const handleSave = async (provider: string) => {
    const key = inputs[provider]?.trim()
    if (!key) return
    setSaving(provider)
    setKeyError(null)
    const res = await fetch("/api/settings/keys", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, key }),
    })
    if (!res.ok) {
      const resData = await res.json().catch(() => ({}))
      setKeyError(resData.error || "Failed to save key")
      setSaving(null)
      return
    }
    setInputs((p) => ({ ...p, [provider]: "" }))
    setSaving(null)
    await mutate()
  }

  const handleDelete = async (provider: string) => {
    setSaving(provider)
    setKeyError(null)
    const res = await fetch("/api/settings/keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    })
    if (!res.ok) {
      const resData = await res.json().catch(() => ({}))
      setKeyError(resData.error || "Failed to delete key")
    }
    setSaving(null)
    await mutate()
  }

  return (
    <section className="border border-border/60 bg-card">
      <div className="px-5 pt-5 pb-2">
        <div className="ui-section-title">Provider Keys</div>
        <div className="ui-section-caption">Encrypted provider and AI Gateway keys used for model execution and CLI harnesses.</div>
      </div>
      <div className="px-5 pb-5">
        {platformAiEnabled === false && (
          <div className="mb-3 rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-5 text-amber-300">
            Platform AI is not enabled for this account. Add your own AI Gateway, OpenAI, Anthropic, or OpenRouter key to use reviews, edits, and CLI harnesses.
          </div>
        )}
        {keyError && (
          <div className="mb-3 px-2 py-1 text-sm text-destructive">
            {keyError} <button onClick={() => setKeyError(null)} className="underline">Dismiss</button>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(PROVIDER_META).map(([provider, meta]) => {
            const isConfigured = configuredProviders.has(provider)
            const keyEntry = keys.find((k) => k.provider === provider)
            const isSaving = saving === provider

            return (
              <div key={provider} className="rounded-lg border border-border bg-background/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{meta.label}</div>
                    <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{meta.description}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${isConfigured ? "bg-accent-green/10 text-accent-green" : "bg-secondary text-muted-foreground"}`}>
                    {isConfigured ? "Connected" : "Not configured"}
                  </span>
                </div>
                {isConfigured ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground font-mono">
                        {meta.masked}
                      </span>
                      {keyEntry && (
                        <span className="text-[11px] text-muted-foreground">
                          · added {new Date(keyEntry.created_at).toLocaleDateString()}
                        </span>
                      )}
                      <div className="ml-auto flex gap-1.5">
                        <button
                          onClick={() => void handleVerify(provider)}
                          disabled={verifying === provider}
                          className="rounded-sm border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {verifying === provider ? "Checking..." : "Verify"}
                        </button>
                        <button
                          onClick={() => void handleDelete(provider)}
                          disabled={isSaving}
                          className="rounded-sm border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-accent-red"
                        >
                          {isSaving ? "..." : "Delete"}
                        </button>
                      </div>
                    </div>
                    {verifyResults[provider] && (
                      <div className="space-y-1 rounded-sm border border-border px-2.5 py-2 text-[11px] leading-5">
                        <div className="flex items-center gap-1.5">
                          <span className={verifyResults[provider].key_valid ? "text-accent-green" : verifyResults[provider].key_valid === false ? "text-accent-red" : "text-muted-foreground"}>
                            {verifyResults[provider].key_valid ? "●" : verifyResults[provider].key_valid === false ? "●" : "○"}
                          </span>
                          <span className="text-foreground">
                            API key {verifyResults[provider].key_valid ? "valid" : verifyResults[provider].key_valid === false ? "invalid" : "not checked"}
                          </span>
                          {verifyResults[provider].key_error && (
                            <span className="text-muted-foreground">— {verifyResults[provider].key_error}</span>
                          )}
                        </div>
                        <div className="text-muted-foreground">
                          {verifyResults[provider].harness && verifyResults[provider].package
                            ? `Harness: ${verifyResults[provider].harness} (${verifyResults[provider].package})`
                            : `Service: ${verifyResults[provider].service}`}
                        </div>
                        <button
                          onClick={() => setVerifyResults((prev) => { const next = { ...prev }; delete next[provider]; return next })}
                          className="text-muted-foreground hover:text-foreground underline"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <input
                      type="password"
                      value={inputs[provider] || ""}
                      onChange={(e) => setInputs((p) => ({ ...p, [provider]: e.target.value }))}
                      placeholder={meta.placeholder}
                      className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground"
                    />
                    <button
                      onClick={() => void handleSave(provider)}
                      disabled={isSaving || !inputs[provider]?.trim()}
                      className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
                    >
                      {isSaving ? "..." : "Save"}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

const EMPTY_CONNECTIONS: Connection[] = []

export function SettingsPageClient({ scope }: { scope: ScopeContext }) {
  if (scope.kind === "team") {
    return <TeamSettingsClient teamId={scope.teamId} teamSlug={scope.slug} />
  }

  return <PersonalSettingsClient />
}

function PersonalSettingsClient() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tabParam = searchParams?.get("tab") ?? ""
  const subParam = searchParams?.get("sub") ?? ""
  const activeTab: SettingsTab = SETTINGS_TAB_SET.has(tabParam) ? (tabParam as SettingsTab) : "account"
  const activeSubTab: KeysSubTab = KEYS_SUB_TAB_SET.has(subParam) ? (subParam as KeysSubTab) : "api"

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "")
      params.set("tab", value)
      params.delete("sub")
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  const handleSubTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "")
      params.set("tab", "keys")
      params.set("sub", value)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  useEffect(() => {
    if (typeof window === "undefined") return
    const hash = window.location.hash.replace(/^#/, "")
    if (!hash) return
    const mapped = LEGACY_HASH_TO_TAB[hash]
    if (!mapped) return
    const params = new URLSearchParams(window.location.search)
    params.set("tab", mapped)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [router, pathname])

  const { user, isLoading } = useUser()
  const [defaultModel, setDefaultModel] = useState("")
  const [saving, setSaving] = useState(false)
  const {
    data: settingsData,
    error: settingsError,
    mutate: mutateSettings,
  } = useSWR<SettingsView>(
    "/api/settings",
    (url: string) => fetchJsonObject<SettingsView>(url, "Failed to load settings"),
  )
  const settingsLoadError = settingsError ? "Unable to load settings preferences" : null
  const {
    data: githubInstallations,
    error: githubInstallationsError,
  } = useSWR<GithubInstallationView[]>(
    "/api/github/installations",
    (url: string) => fetchJsonArray<GithubInstallationView>(url, "Failed to load GitHub installations"),
  )
  const { data: githubOwnerTargets } = useSWR<GithubOwnerTarget[]>(
    user?.github_connected ? "/api/github/owners" : null,
    (url: string) => fetchJsonArray<GithubOwnerTarget>(url, "Failed to load GitHub accounts"),
  )
  const { data: connectionsData, error: connSWRError, mutate: mutateConnections } = useSWR<{ connections: Connection[] }>(
    "/api/connections",
    (url: string) => fetchJsonObject<{ connections: Connection[] }>(url, "Failed to load connections"),
  )
  const connections = connectionsData?.connections ?? EMPTY_CONNECTIONS
  const ownerTargets = githubOwnerTargets ?? []
  const ownerTargetsNeedingInstall = ownerTargets.filter((target) => target.github_installation_id == null)
  const connError = connSWRError ? "Unable to load connections" : null
  const githubInstallationsLoadError = githubInstallationsError ? "Unable to load GitHub App installations" : null
  const [newConn, setNewConn] = useState(INITIAL_CONNECTION_FORM)
  const [connectionSaving, setConnectionSaving] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [activePreset, setActivePreset] = useState<ConnectionPreset | null>(null)
  const [presetCredentials, setPresetCredentials] = useState<Record<string, string>>({})
  const [presetMcpUrl, setPresetMcpUrl] = useState("")
  const [presetSaving, setPresetSaving] = useState(false)
  // Synchronous guard against rapid double-tap. setPresetSaving is async, so
  // two clicks in the same tick can both pass the state-based gate; the ref
  // flips immediately and closes that window.
  const presetSavingRef = useRef(false)
  const [presetStatus, setPresetStatus] = useState<{ presetId: string; type: "success" | "error" | "testing"; message: string } | null>(null)
  const [oauthStatus] = useState<string | null>(() => searchParams?.get("oauth") ?? null)
  const platformAccess = user ? user.platform_access : null
  const platformAiEnabled = platformAccess?.allowPlatformAi ?? null

  const githubPrimaryAction = useMemo(() => {
    if (user?.github_primary_action) return user.github_primary_action
    if (!user?.github_connected) {
      return {
        label: user?.github_app_available ? "Install GitHub App" : "Connect GitHub",
        href: "/api/auth/github",
      }
    }
    return null
  }, [user])

  const showGithubAddInstallAction = Boolean(
    user?.github_app_available &&
    user?.github_connected &&
    githubPrimaryAction?.href !== "/api/auth/github",
  )

  const nextStep = useMemo(() => {
    if (githubPrimaryAction) {
      const githubState = user?.github_state
      const title = githubState === "app_installed"
        ? "Sync repositories next"
        : githubState === "app_install_pending"
          ? "Complete the GitHub App install"
          : githubState === "oauth_connected"
            ? "Upgrade GitHub from OAuth to the App"
            : "Install GitHub App next"
      const description = githubState === "app_installed"
        ? "Open Projects and sync the repositories covered by your GitHub App installation into Mogplex."
        : user?.github_status_detail || "GitHub powers repo sync, trigger coverage, and automation."
      return {
        title,
        description,
        href: githubPrimaryAction.href,
        label: githubPrimaryAction.label,
      }
    }

    if (!user?.github_connected) {
      return {
        title: user?.github_app_available ? "Install GitHub App next" : "Connect GitHub next",
        description: "GitHub is required to import repositories and make Open Workspace useful.",
        href: "/api/auth/github",
        label: user?.github_app_available ? "Install GitHub App" : "Connect GitHub",
      }
    }

    return null
  }, [githubPrimaryAction, user])

  const trackConnectionStart = useCallback((provider: "github", source: string) => {
    if (provider === "github") {
      trackActivation("github_connect_started", {
        source,
        connection_mode: user?.github_app_available ? "app" : "oauth",
      })
    }
  }, [user?.github_app_available])

  useEffect(() => {
    if (typeof settingsData?.default_model === "string") {
      setDefaultModel(settingsData.default_model)
    }
  }, [settingsData])

  const savePreference = useCallback(async (key: "default_model", value: string) => {
    setSaving(true)
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    })
    if (!response.ok) {
      setSaving(false)
      throw new Error(`Failed to save ${key}`)
    }
    await mutateSettings((current) => ({
      ...(current ?? {}),
      [key]: value,
    }), false)
    setSaving(false)
  }, [mutateSettings])

  const saveDefaultModel = useCallback(async (modelId: string) => {
    const previousModel = defaultModel
    setDefaultModel(modelId)
    try {
      await savePreference("default_model", modelId)
    } catch {
      setDefaultModel(previousModel)
    }
  }, [defaultModel, savePreference])

  const addConnection = async () => {
    if (!newConn.name.trim()) return
    if (newConn.type === "rest_api" && !newConn.base_url.trim()) return
    if (newConn.type === "mcp_server" && !newConn.mcp_url.trim()) return
    setConnectionSaving(true)
    setConnectionError(null)
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newConn),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setConnectionError(data.error || "Failed to add connection")
        return
      }

      setNewConn(INITIAL_CONNECTION_FORM)
      await mutateConnections()
    } catch {
      setConnectionError("Network error while adding connection")
    } finally {
      setConnectionSaving(false)
    }
  }

  const toggleConnection = async (conn: Connection) => {
    setConnectionError(null)
    try {
      const res = await fetch("/api/connections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: conn.id, is_enabled: !conn.is_enabled }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setConnectionError(data.error || "Failed to update connection")
        return
      }
      await mutateConnections()
    } catch {
      setConnectionError("Network error while updating connection")
    }
  }

  const removeConnection = async (id: string) => {
    setConnectionError(null)
    try {
      const res = await fetch("/api/connections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setConnectionError(data.error || "Failed to delete connection")
        return
      }
      await mutateConnections()
    } catch {
      setConnectionError("Network error while deleting connection")
    }
  }

  const testConnection = async (id: string) => {
    setTesting(id)
    setConnectionError(null)
    try {
      const res = await fetch(`/api/connections/${id}/test`, { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setConnectionError(data.error || "Failed to test connection")
      }
    } catch {
      setConnectionError("Network error while testing connection")
    }
    setTesting(null)
    await mutateConnections()
  }

  const presetStates = useMemo(
    () =>
      Object.fromEntries(
        CONNECTION_PRESETS.map((preset) => [
          preset.id,
          getPresetConnectionState(
            {
              presetId: preset.id,
              usesManagedConnectionAuth: usesManagedConnectionAuth(preset),
            },
            connections
          ),
        ])
      ) as Record<string, ReturnType<typeof getPresetConnectionState>>,
    [connections]
  )

  const configuredPresetIds = useMemo(() => new Set(
    Object.entries(presetStates)
      .filter(([, state]) => !state.isAddable)
      .map(([presetId]) => presetId)
  ), [presetStates])

  const oauthNotice = useMemo(() => {
    switch (oauthStatus) {
      case "success":
        return { tone: "text-accent-green", message: "OAuth connection established. Run a test to verify tools." }
      case "invalid_state":
        return { tone: "text-destructive", message: "OAuth sign-in could not be verified. Try connecting again." }
      case "not_found":
        return { tone: "text-destructive", message: "The connection could not be found for OAuth completion." }
      case "token_error":
        return { tone: "text-destructive", message: "OAuth token exchange failed. Try reconnecting the connection." }
      case "setup_error":
        return { tone: "text-destructive", message: "OAuth setup failed before redirect. Check the preset configuration and try again." }
      default:
        return null
    }
  }, [oauthStatus])

  useEffect(() => {
    if (oauthStatus === "success") {
      void mutateConnections()
    }
  }, [mutateConnections, oauthStatus])

  useEffect(() => {
    if (!oauthStatus) return
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    params.delete("oauth")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [oauthStatus, pathname, router])

  const initiateOAuth = useCallback((connection: Pick<Connection, "id" | "source_preset">) => {
    window.location.href = getConnectionAuthorizationPath({
      connectionId: connection.id,
      sourcePreset: connection.source_preset,
    })
  }, [])

  const addPresetConnection = async (preset: ConnectionPreset) => {
    if (presetSavingRef.current) return
    const requiresCredential = preset.auth_fields.length > 0
    if (preset.mcp_url_field && !presetMcpUrl.trim()) return
    const trimmedCredentials: Record<string, string> = {}
    for (const field of preset.auth_fields) {
      trimmedCredentials[field.key] = (presetCredentials[field.key] ?? "").trim()
    }
    if (requiresCredential && preset.auth_fields.some(f => !trimmedCredentials[f.key])) return
    // The API + storage layer treat `credentials` as a single opaque string. Every
    // current preset has 0 or 1 auth_fields, so the single-field path is the only
    // one exercised. Multi-field presets would need a typed string|Record contract
    // plumbed through validation.ts → service.ts and a matching decoder in the MCP
    // resolver before we can store them; fail loudly until that's wired up.
    if (preset.auth_fields.length > 1) {
      setPresetStatus({
        presetId: preset.id,
        type: "error",
        message: "Multi-field credentials are not supported yet.",
      })
      return
    }
    const credentialsPayload = requiresCredential
      ? trimmedCredentials[preset.auth_fields[0].key]
      : undefined
    presetSavingRef.current = true
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
          ...(credentialsPayload !== undefined ? { credentials: credentialsPayload } : {}),
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
          await mutateConnections()
          if (preset.auth_type === "oauth" && data.connection?.id) {
            initiateOAuth(data.connection)
            return
          }
          setActivePreset(null)
          setPresetCredentials({})
          setPresetMcpUrl("")
          setPresetStatus({
            presetId: preset.id,
            type: "success",
            message: data.error || "Already connected",
          })
          scrollToConnectionRow(data.connection?.id)
          return
        }
        setPresetStatus({ presetId: preset.id, type: "error", message: data.error || "Failed to create connection" })
        return
      }
      const { connection } = await res.json() as { connection?: Connection }
      setActivePreset(null)
      setPresetCredentials({})
      setPresetMcpUrl("")
      await mutateConnections()

      if (preset.auth_type === "oauth" && connection?.id) {
        initiateOAuth(connection)
        return
      }

      // Auto-test the new connection
      if (connection?.id) {
        setPresetStatus({ presetId: preset.id, type: "testing", message: "Testing..." })
        const testRes = await fetch(`/api/connections/${connection.id}/test`, { method: "POST" })
        const testData = await testRes.json().catch(() => ({})) as {
          healthy?: boolean
          toolCount?: number
          error?: string
        }
        await mutateConnections()
        setPresetStatus({
          presetId: preset.id,
          type: testRes.ok && testData.healthy ? "success" : "error",
          message: testData.healthy
            ? `Connected${testData.toolCount != null ? ` · ${testData.toolCount} tools` : ""}`
            : testData.error || "Connection test failed",
        })
      } else {
        setPresetStatus({ presetId: preset.id, type: "success", message: "Created" })
      }
    } catch {
      setPresetStatus({ presetId: preset.id, type: "error", message: "Network error" })
    } finally {
      presetSavingRef.current = false
      setPresetSaving(false)
    }
  }

  return (
    <div className="min-h-full p-3 space-y-4 md:p-6 md:space-y-6">
      <SlackInstallToast />
      <div>
        <h1 className="ui-page-title">Settings</h1>
        <div className="ui-page-subtitle">Account connections and preferences.</div>
      </div>

      {settingsLoadError && (
        <div className="text-sm text-destructive">{settingsLoadError}</div>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-4 md:gap-6">
        <ScrollArea className="w-full">
          <TabsList className="h-8 inline-flex w-max bg-transparent p-0 gap-1">
            <TabsTrigger value="account" className="px-3 h-7 text-[13px]">Account</TabsTrigger>
            <TabsTrigger value="teams" className="px-3 h-7 text-[13px]">Teams</TabsTrigger>
            <TabsTrigger value="connections" className="px-3 h-7 text-[13px]">Connections</TabsTrigger>
            <TabsTrigger value="keys" className="px-3 h-7 text-[13px]">Keys &amp; Tokens</TabsTrigger>
            <TabsTrigger value="models" className="px-3 h-7 text-[13px]">Models</TabsTrigger>
          </TabsList>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <TabsContent value="account" className="mt-0">
      <section className="border border-border/60 bg-card">
        <div className="px-5 pt-5 pb-2">
          <div className="ui-section-title">Account</div>
          <div className="ui-section-caption">GitHub is your account identity. Manage Vercel from the Connections tab.</div>
        </div>
        <div className="px-5 pb-5 space-y-4">
          <div className="grid gap-3">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-foreground">GitHub App coverage</div>
                  <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    GitHub determines which repos can sync into Projects and which repos are actually triggerable.
                  </div>
                </div>
                <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${
                  user?.github_state === "app_installed_with_synced_repos"
                    ? "bg-accent-green/10 text-accent-green"
                    : user?.github_connected
                      ? "bg-amber-400/10 text-amber-300"
                      : "bg-secondary text-muted-foreground"
                }`}>
                  {user?.github_status_label || (isLoading ? "Loading..." : "Required")}
                </span>
              </div>
              <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
                {user?.github_status_detail || "No GitHub connection yet"}
                {user?.github_username ? ` · ${user.github_username}` : ""}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                <span className="rounded-full border border-border px-2 py-0.5">
                  {user?.github_installation_count ?? 0} installation{user?.github_installation_count === 1 ? "" : "s"}
                </span>
                <span className="rounded-full border border-border px-2 py-0.5">
                  {user?.github_synced_repo_count ?? 0} synced space{user?.github_synced_repo_count === 1 ? "" : "s"}
                </span>
              </div>
              {githubPrimaryAction && !isLoading && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={githubPrimaryAction.href}
                    {...(githubPrimaryAction.href === "/api/auth/github" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    onClick={() => {
                      if (githubPrimaryAction?.href === "/api/auth/github") {
                        trackConnectionStart("github", "settings_github_card")
                      }
                    }}
                    data-testid="settings-github-connect"
                    className="inline-flex rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
                  >
                    {githubPrimaryAction.label}
                  </a>
                  {showGithubAddInstallAction && (
                    <a
                      href="/api/auth/github"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackConnectionStart("github", "settings_github_add_install")}
                      data-testid="settings-github-add-install"
                      className="inline-flex rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
                    >
                      Add org or personal install
                    </a>
                  )}
                </div>
              )}
              {!githubPrimaryAction && showGithubAddInstallAction && !isLoading && (
                <div className="mt-4 space-y-2">
                  <a
                    href="/api/auth/github"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackConnectionStart("github", "settings_github_add_install")}
                    data-testid="settings-github-add-install"
                    className="inline-flex rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
                  >
                    Add org or personal install
                  </a>
                  <div className="text-[11px] leading-5 text-muted-foreground">
                    Re-open the GitHub App installer any time you need coverage for another org or for your personal GitHub account.
                  </div>
                </div>
              )}
              {githubInstallationsLoadError && (
                <div className="mt-4 rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] text-amber-300">
                  {githubInstallationsLoadError}
                </div>
              )}
              {ownerTargets.length > 0 && (
                <div className="mt-6 space-y-2">
                  <div className="ui-kicker">Available accounts</div>
                  {ownerTargets.map((target) => {
                    const installed = target.github_installation_id != null

                    return (
                      <div key={`${target.kind}-${target.login}`} className="rounded-lg border border-border bg-card/70 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm text-foreground">
                              {target.login}
                            </div>
                            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                              {target.scope_label} account
                              {installed
                                ? " · GitHub App installed"
                                : " · OAuth can see it, but App coverage is missing"}
                            </div>
                          </div>
                          {installed ? (
                            <span className="rounded-full bg-accent-green/10 px-2 py-0.5 text-[11px] text-accent-green">
                              Installed
                            </span>
                          ) : (
                            <a
                              href="/api/auth/github"
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => trackConnectionStart("github", "settings_github_owner_install")}
                              className="text-[11px] text-accent-blue hover:underline"
                            >
                              Add in GitHub
                            </a>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {ownerTargetsNeedingInstall.length > 0 && (
                    <div className="text-[11px] leading-5 text-muted-foreground">
                      Accounts marked without App coverage can still appear through OAuth, but PR reviews, triggers, and repo coverage need a GitHub App install for that account.
                    </div>
                  )}
                </div>
              )}
              {(githubInstallations?.length || 0) > 0 && (
                <div className="mt-6 space-y-2">
                  <div className="ui-kicker">Installed scopes</div>
                  {githubInstallations?.map((installation) => (
                    <div key={installation.id} className="rounded-lg border border-border bg-card/70 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-foreground">
                            {installation.account_login || `Installation ${installation.installation_id}`}
                          </div>
                          <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                            {installation.scope_label} scope · {installation.synced_repo_count} synced repo{installation.synced_repo_count === 1 ? "" : "s"}
                          </div>
                          {installation.repositories.length > 0 && (
                            <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
                              {installation.repositories.slice(0, 3).map((repo) => repo.full_name).join(", ")}
                              {installation.repositories.length > 3 ? ` +${installation.repositories.length - 3} more` : ""}
                            </div>
                          )}
                        </div>
                        {installation.manage_url ? (
                          <a
                            href={installation.manage_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-accent-blue hover:underline"
                          >
                            Manage on GitHub
                          </a>
                        ) : (
                          <div className="text-[11px] text-muted-foreground">
                            Manage in GitHub settings unavailable until installation metadata is refreshed
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {nextStep && (
            <div className="rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-4 py-3">
              <div className="text-sm font-medium text-foreground">{nextStep.title}</div>
              <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{nextStep.description}</div>
              <a
                href={nextStep.href}
                onClick={() => {
                  if (nextStep.href === "/api/auth/github") {
                    trackConnectionStart("github", "settings_next_step")
                  }
                }}
                className="mt-3 inline-flex rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {nextStep.label}
              </a>
            </div>
          )}
        </div>
      </section>

        </TabsContent>

        <TabsContent value="teams" className="mt-0">
          <TeamsListSection />
        </TabsContent>

        <TabsContent value="connections" className="mt-0">
      <section className="border border-border/60 bg-card">
        <div className="px-5 pt-5 pb-2">
          <div className="ui-section-title">Connections</div>
          <div className="ui-section-caption">External APIs and MCP servers your agents can use.</div>
        </div>
        {oauthNotice && (
          <div className={`mx-4 mt-2 text-xs px-2 py-1 ${oauthNotice.tone}`}>
            {oauthNotice.message}
          </div>
        )}
        {connError && (
          <div className="mx-4 mt-2 text-xs text-destructive px-2 py-1">
            {connError} <button onClick={() => void mutateConnections()} className="underline">Retry</button>
          </div>
        )}
        <div className="px-5 pb-0 space-y-5">
          <div>
            <div className="ui-kicker mb-2">Quick Add — MCP Presets</div>
            <div
              data-testid="settings-preset-manual-hint"
              className="mb-3 text-[11px] text-muted-foreground"
            >
              {CONNECTION_PRESET_MANUAL_HINT}
            </div>
            <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
              {CONNECTION_PRESETS.map(preset => {
                const presetState = presetStates[preset.id]
                const isConfigured = configuredPresetIds.has(preset.id)
                const isActive = activePreset?.id === preset.id
                const status = presetStatus?.presetId === preset.id ? presetStatus : null
                const isConnected = isConfigured && presetState.label === "Connected"
                const Icon = getPresetIcon(preset.id)
                return (
                  <div
                    key={preset.id}
                    data-testid={`settings-preset-${preset.id}`}
                    className={`border p-2.5 space-y-1.5 transition-colors ${
                      isConfigured
                        ? isConnected
                          ? "border-accent-green/30 bg-accent-green/[0.04]"
                          : "border-amber-400/30 bg-amber-400/[0.04]"
                        : "border-border bg-background"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon
                        size={20}
                        className={`shrink-0 mt-px ${
                          isConnected
                            ? "text-accent-green"
                            : isConfigured
                              ? "text-amber-400"
                              : "text-muted-foreground"
                        }`}
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs text-foreground font-medium truncate">{preset.name}</span>
                          {!isConfigured && (
                            <button
                              onClick={() => { setActivePreset(isActive ? null : preset); setPresetCredentials({}); setPresetMcpUrl(""); setPresetStatus(null) }}
                              className="text-[11px] text-accent-blue hover:underline shrink-0"
                            >
                              {isActive ? "Cancel" : "+ Add"}
                            </button>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground leading-tight">{preset.description}</div>
                      </div>
                    </div>
                    {isConfigured && (
                      <button
                        onClick={() => scrollToConnectionRow(presetState.connection?.id)}
                        className="flex items-center gap-1.5 text-[11px] hover:underline"
                      >
                        <span
                          className={`size-1.5 rounded-full shrink-0 ${
                            isConnected ? "bg-accent-green" : "bg-amber-400"
                          }`}
                          aria-hidden="true"
                        />
                        <span className={isConnected ? "text-accent-green" : "text-amber-400"}>
                          {presetState.label}
                        </span>
                      </button>
                    )}
                    {isConfigured && presetState.detail && (
                      <div className="text-[11px] text-amber-400 leading-tight">{presetState.detail}</div>
                    )}
                    {status && !isActive && (
                      <div className={`text-[11px] ${status.type === "success" ? "text-accent-green" : status.type === "error" ? "text-red-400" : "text-muted-foreground"}`}>
                        {status.message}
                      </div>
                    )}
                    {isActive && (
                      <div className="pt-1 space-y-1.5">
                        {preset.mcp_url_field && (
                          <>
                            <div className="text-[11px] text-muted-foreground leading-tight">
                              Paste the full MCP server URL from Zapier&apos;s Connect tab. This URL is secret and can be rotated from Zapier later.
                            </div>
                            <input
                              type={preset.mcp_url_field.secret ? "password" : "text"}
                              value={presetMcpUrl}
                              onChange={e => setPresetMcpUrl(e.target.value)}
                              placeholder={preset.mcp_url_field.placeholder}
                              className="w-full border border-border bg-input px-2 py-1 text-[11px] text-foreground"
                            />
                          </>
                        )}
                        {preset.auth_type === "oauth" ? (
                          <div className="text-[11px] text-muted-foreground leading-tight">
                            {getConnectionPresetAuthorizationDescription(preset)}
                          </div>
                        ) : (
                          preset.auth_fields.map(field => (
                            <input
                              key={field.key}
                              type={field.secret ? "password" : "text"}
                              value={presetCredentials[field.key] ?? ""}
                              onChange={e => {
                                const next = e.target.value
                                setPresetCredentials(prev => ({ ...prev, [field.key]: next }))
                              }}
                              placeholder={field.placeholder}
                              className="w-full border border-border bg-input px-2 py-1 text-[11px] text-foreground"
                            />
                          ))
                        )}
                        {status?.type === "error" && (
                          <div className="text-[11px] text-red-400">{status.message}</div>
                        )}
                        <div className="flex items-center justify-between">
                          <a href={preset.docs_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted-foreground hover:text-foreground">Docs</a>
                          <button
                            onClick={() => void addPresetConnection(preset)}
                            disabled={(!!preset.mcp_url_field && !presetMcpUrl.trim()) || (preset.auth_fields.some(f => !(presetCredentials[f.key] ?? "").trim())) || presetSaving}
                            className="px-3 py-1.5 text-[11px] bg-primary text-primary-foreground disabled:opacity-50"
                          >
                            {presetSaving ? "..." : preset.auth_type === "oauth" ? "Connect" : "Add"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        {connections.length > 0 && (
          <div className="max-h-[40vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 text-[12px] text-muted-foreground">
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {connections.map(c => {
                  const preset = getConnectionPreset(c.source_preset)
                  const displayState = getConnectionDisplayState({
                    ...c,
                    needsManagedAuthReconnect:
                      usesManagedConnectionAuth(preset) &&
                      c.auth_type !== "oauth",
                  })
                  const RowIcon = getPresetIcon(c.source_preset)
                  return (
                  <tr
                    key={c.id}
                    data-connection-id={c.id}
                    className={`border-b border-border/40 hover:bg-secondary/50 ${displayState.rowMuted ? "opacity-60" : ""}`}
                  >
                    <td className="px-4 py-2 text-foreground">
                      <div className="flex items-center gap-2">
                        <RowIcon size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span>{c.name}</span>
                        {preset && (
                          <span className="font-mono text-[11px] px-1.5 py-px rounded border text-purple-300 border-purple-400/20 bg-purple-400/[0.06]">
                            preset · {preset.name}
                          </span>
                        )}
                        {!c.is_enabled && (
                          <span className="font-mono text-[11px] px-1.5 py-px rounded border text-amber-400 border-amber-400/20 bg-amber-400/[0.06]">
                            disabled
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.type === "rest_api" ? "REST API" : "MCP Server"}</td>
                    <td className="px-4 py-2">
                      <div className="space-y-0.5">
                        <div className={`text-[11px] ${getConnectionStatusTone(c.health_status)}`}>
                          {getConnectionStatusLabel(c.health_status)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {getConnectionStatusDetail(c)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatConnectionLastTested(c.last_tested_at)}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button aria-label="Connection actions" className="px-1.5 py-0.5 text-muted-foreground hover:text-foreground rounded hover:bg-secondary text-sm">···</button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          {displayState.oauthActionLabel && (
                            <>
                              <DropdownMenuItem onSelect={() => initiateOAuth(c)}>
                                {displayState.oauthActionLabel} OAuth
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          <DropdownMenuItem onSelect={() => void testConnection(c.id)} disabled={testing === c.id}>
                            {testing === c.id ? "Testing..." : "Test Connection"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void toggleConnection(c)}>
                            {c.is_enabled ? "Disable" : "Enable"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => void removeConnection(c.id)}>
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-6 border-t border-border/40 px-5 py-5 space-y-3">
          <div className="ui-kicker mb-2">Add Connection</div>
          {connectionError && (
            <div className="text-[11px] text-red-400">
              {connectionError}
            </div>
          )}
          <div className="flex gap-2">
            <select
              value={newConn.type}
              onChange={e => setNewConn((p) => {
                const nextType = e.target.value as "rest_api" | "mcp_server"
                const nextAuthType = nextType === "mcp_server" && p.auth_type === "none"
                  ? "bearer"
                  : p.auth_type

                return {
                  ...p,
                  type: nextType,
                  auth_type: nextAuthType,
                  auth_header: getDefaultAuthHeader(nextAuthType),
                }
              })}
              className="border border-border bg-input px-3 py-2 text-sm text-foreground"
            >
              <option value="rest_api">REST API</option>
              <option value="mcp_server">MCP Server</option>
            </select>
            <input value={newConn.name} onChange={e => setNewConn(p => ({ ...p, name: e.target.value }))} placeholder="name" className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
            <input value={newConn.description} onChange={e => setNewConn(p => ({ ...p, description: e.target.value }))} placeholder="description (optional)" className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
          </div>
          {newConn.type === "rest_api" ? (
            <>
              <div className="flex gap-2">
                <input value={newConn.base_url} onChange={e => setNewConn(p => ({ ...p, base_url: e.target.value }))} placeholder="https://api.example.com" className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
                <select
                  value={newConn.auth_type}
                  onChange={e => setNewConn(p => ({
                    ...p,
                    auth_type: e.target.value,
                    auth_header: getDefaultAuthHeader(e.target.value),
                  }))}
                  className="border border-border bg-input px-3 py-2 text-sm text-foreground"
                >
                  {CONNECTION_AUTH_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {newConn.auth_type !== "none" && (
                  <input value={newConn.credentials} onChange={e => setNewConn(p => ({ ...p, credentials: e.target.value }))} placeholder="credential" type="password" className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
                )}
              </div>
              {(newConn.auth_type === "bearer" || newConn.auth_type === "api_key") && (
                <input
                  value={newConn.auth_header}
                  onChange={e => setNewConn(p => ({ ...p, auth_header: e.target.value }))}
                  placeholder={newConn.auth_type === "api_key" ? "X-API-Key" : "Authorization"}
                  className="w-full border border-border bg-input px-3 py-2 text-sm text-foreground"
                />
              )}
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <input value={newConn.mcp_url} onChange={e => setNewConn(p => ({ ...p, mcp_url: e.target.value }))} placeholder="https://mcp.example.com" className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
                <select value={newConn.mcp_transport} onChange={e => setNewConn(p => ({ ...p, mcp_transport: e.target.value as "sse" | "http" }))} className="border border-border bg-input px-3 py-2 text-sm text-foreground">
                  <option value="http">HTTP</option>
                  <option value="sse">SSE</option>
                </select>
                <select
                  value={newConn.auth_type}
                  onChange={e => setNewConn(p => ({
                    ...p,
                    auth_type: e.target.value,
                    auth_header: getDefaultAuthHeader(e.target.value),
                  }))}
                  className="border border-border bg-input px-3 py-2 text-sm text-foreground"
                >
                  {CONNECTION_AUTH_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {newConn.auth_type !== "none" && (
                  <input value={newConn.credentials} onChange={e => setNewConn(p => ({ ...p, credentials: e.target.value }))} placeholder={newConn.auth_type === "api_key" ? "API key" : newConn.auth_type === "basic" ? "base64 user:pass" : "token"} type="password" className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
                )}
              </div>
              {(newConn.auth_type === "bearer" || newConn.auth_type === "api_key") && (
                <input
                  value={newConn.auth_header}
                  onChange={e => setNewConn(p => ({ ...p, auth_header: e.target.value }))}
                  placeholder={newConn.auth_type === "api_key" ? "X-API-Key" : "Authorization"}
                  className="w-full border border-border bg-input px-3 py-2 text-sm text-foreground"
                />
              )}
            </>
          )}
          <button
            onClick={addConnection}
            disabled={connectionSaving}
            className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {connectionSaving ? "Adding..." : "Add Connection"}
          </button>
        </div>
      </section>

      <section className="border border-border/60 bg-card mt-6">
        <div className="px-5 pt-5 pb-2">
          <div className="ui-section-title flex items-center gap-2">
            <SlackFill size={16} aria-hidden="true" className="shrink-0" />
            <span>Slack</span>
          </div>
          <div className="ui-section-caption">Install the Mogplex Slack app to @-mention agents and DM the bot. Channel-to-repo mapping happens here too.</div>
        </div>
        <div className="px-5 pb-5">
          <SlackSection />
        </div>
      </section>

        </TabsContent>

        <TabsContent value="keys" className="mt-0">
          <Tabs value={activeSubTab} onValueChange={handleSubTabChange} className="gap-4">
            <TabsList className="h-8 inline-flex w-max bg-transparent p-0 gap-1">
              <TabsTrigger value="api" className="px-3 h-7 text-[13px]">Provider Keys</TabsTrigger>
              <TabsTrigger value="cli" className="px-3 h-7 text-[13px]">Mogplex Keys</TabsTrigger>
            </TabsList>
            <TabsContent value="api" className="mt-0">
              <ApiKeysSection platformAiEnabled={isLoading ? null : platformAiEnabled} />
            </TabsContent>
            <TabsContent value="cli" className="mt-0">
              <CliApiKeysSection />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="models" className="mt-0">
      <ModelsSection
        defaultModel={defaultModel}
        onSetDefault={saveDefaultModel}
        savingDefault={saving}
      />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default SettingsPageClient
