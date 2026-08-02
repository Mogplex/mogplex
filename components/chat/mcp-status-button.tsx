"use client"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useConnections, type CreateMcpInput } from "@/hooks/use-connections"
import { scopedHref } from "@/lib/scoped-href"
import { MAX_MCP_CONNECTIONS } from "@/lib/connections/constants"
import { getConnectionStatusLabel } from "@/lib/connections/status"
import type { ConnectionHealthStatus } from "@/lib/connections/status"
import { summarizeMcpStatus } from "@/lib/connections/status-summary"

type MenuPos = { left: number; bottom: number }

const STATUS_DOT: Record<ConnectionHealthStatus, string> = {
  healthy: "bg-green-500",
  auth_failed: "bg-amber-400",
  misconfigured: "bg-amber-400",
  unreachable: "bg-red-500",
  error: "bg-red-500",
  testing: "bg-accent-blue",
  unknown: "bg-muted-foreground",
}

const STATUS_TEXT: Record<ConnectionHealthStatus, string> = {
  healthy: "text-green-500",
  auth_failed: "text-amber-400",
  misconfigured: "text-amber-400",
  unreachable: "text-red-500",
  error: "text-red-500",
  testing: "text-accent-blue",
  unknown: "text-muted-foreground",
}

export function McpStatusButton({ repoId }: { repoId?: string }) {
  const { scope } = useParams<{ scope: string }>()
  const {
    mcpServers,
    overrides,
    resolvedMcpCount,
    isLoading,
    setEnabled,
    setExcluded,
    testConnection,
    createMcp,
    refresh,
  } = useConnections({ repoId })
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const posRafRef = useRef<number | null>(null)

  // In repo scope, a global MCP may be excluded for this repo via an override;
  // its effective enabled state is `is_enabled && !excluded`. Use this for
  // display (checkbox, dot, summary) so the repo view is a faithful picture
  // of what's actually available here.
  const excludedSet = useMemo(
    () =>
      new Set(
        overrides
          .filter(o => o.excluded && o.connection_id)
          .map(o => o.connection_id as string),
      ),
    [overrides],
  )
  const effectiveMcpServers = useMemo(() => {
    if (!repoId) return mcpServers
    return mcpServers.map(s =>
      s.scope === "global"
        ? { ...s, is_enabled: s.is_enabled && !excludedSet.has(s.id) }
        : s,
    )
  }, [mcpServers, repoId, excludedSet])

  const summary = summarizeMcpStatus(effectiveMcpServers)

  // Server enforces two separate caps: project scope checks the repo-resolved
  // count; global scope checks the user's total enabled-global count. Mirror
  // that split on the client so the Add trigger and form submit reflect the
  // scope the user actually picks, not just the repo-resolved view.
  const globalEnabledMcpCount = mcpServers.filter(
    s => s.scope === "global" && s.is_enabled,
  ).length
  const projectResolvedMcpCount =
    resolvedMcpCount ?? effectiveMcpServers.filter(s => s.is_enabled).length
  const globalAtCap = globalEnabledMcpCount >= MAX_MCP_CONNECTIONS
  const projectAtCap = projectResolvedMcpCount >= MAX_MCP_CONNECTIONS
  // The Add trigger opens the form; inside the form the user picks a scope.
  // Only block the trigger when every scope they could pick is already full.
  const mcpAtCap = repoId ? globalAtCap && projectAtCap : globalAtCap

  const closeMenu = useCallback(() => {
    setOpen(false)
    setShowAdd(false)
    setErrorMsg(null)
    setTestingId(null)
  }, [])

  // Coalesce scroll/resize-driven position updates to one per frame so
  // bubbling scroll events from nested containers don't thrash setState.
  const computePos = useCallback(() => {
    if (posRafRef.current != null) return
    posRafRef.current = requestAnimationFrame(() => {
      posRafRef.current = null
      if (!btnRef.current) return
      const rect = btnRef.current.getBoundingClientRect()
      setMenuPos({ left: rect.left, bottom: window.innerHeight - rect.top + 4 })
    })
  }, [])

  // Position math runs in a layout effect so we don't mutate during render.
  useLayoutEffect(() => {
    if (!open) return
    computePos()
    const scrollOpts: AddEventListenerOptions = { capture: true, passive: true }
    window.addEventListener("resize", computePos)
    window.addEventListener("scroll", computePos, scrollOpts)
    return () => {
      window.removeEventListener("resize", computePos)
      window.removeEventListener("scroll", computePos, scrollOpts)
      if (posRafRef.current != null) {
        cancelAnimationFrame(posRafRef.current)
        posRafRef.current = null
      }
    }
  }, [open, showAdd, computePos])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t)) return
      if (btnRef.current?.contains(t)) return
      closeMenu()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMenu()
        btnRef.current?.focus()
      }
    }
    window.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [open, closeMenu])

  // Move focus to the popover container on open so screen readers announce it
  // without stealing focus from any specific control.
  useEffect(() => {
    if (!open) return
    menuRef.current?.focus()
  }, [open])

  const handleTest = async (id: string) => {
    setTestingId(id)
    setErrorMsg(null)
    try {
      await testConnection(id)
    } catch (e) {
      setErrorMsg((e as Error).message)
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
        title="MCP tools status"
      >
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${summary.dot}`} />
        <span>{summary.label}</span>
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          role="dialog"
          aria-modal="false"
          aria-label="MCP servers"
          tabIndex={-1}
          className="fixed w-80 bg-card border border-border shadow-lg z-[9999] text-[12px] text-foreground outline-none"
          style={{ left: menuPos.left, bottom: menuPos.bottom }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
              MCP Servers{repoId ? " · this repo" : ""}
            </span>
            <button
              onClick={() => refresh()}
              className="text-[11px] text-accent-blue hover:underline"
            >
              Refresh
            </button>
          </div>

          <div className="max-h-72 overflow-auto">
            {isLoading && mcpServers.length === 0 && (
              <div className="px-3 py-4 text-muted-foreground text-[11px]">Loading…</div>
            )}
            {!isLoading && mcpServers.length === 0 && (
              <div className="px-3 py-4 text-muted-foreground text-[11px]">
                No MCP servers configured.
              </div>
            )}
            {mcpServers.map(server => {
              const dot = STATUS_DOT[server.health_status]
              const text = STATUS_TEXT[server.health_status]
              const isTesting = testingId === server.id
              const isGlobalInRepo = Boolean(repoId) && server.scope === "global"
              const isExcludedHere = isGlobalInRepo && excludedSet.has(server.id)
              // In repo scope the checkbox reflects effective state (global
              // enable gated by the per-repo override). Outside repo scope
              // or on project rows the checkbox tracks is_enabled directly.
              const effectiveEnabled = isGlobalInRepo
                ? server.is_enabled && !isExcludedHere
                : server.is_enabled
              // A global row whose global is_enabled=false cannot be turned
              // on from the repo view (the override only gates exclusion).
              // Disable the checkbox and explain why.
              const toggleDisabled = isGlobalInRepo && !server.is_enabled
              const toggleTitle = toggleDisabled
                ? "Disabled in global settings"
                : isGlobalInRepo
                ? "Exclude from this repo"
                : undefined
              const handleToggle = (checked: boolean) => {
                const action = isGlobalInRepo
                  ? setExcluded(server.id, !checked)
                  : setEnabled(server.id, checked)
                action.catch(err => setErrorMsg((err as Error).message))
              }
              return (
                <div key={server.id} className="px-3 py-2 border-b border-border/50 flex items-start gap-2">
                  <span
                    className={`mt-1 inline-block h-2 w-2 rounded-full ${dot} ${!effectiveEnabled ? "opacity-40" : ""}`}
                    title={getConnectionStatusLabel(server.health_status)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-foreground flex items-center gap-1.5">
                        {server.name}
                        <span
                          className={`px-1 text-[9px] rounded border ${server.scope === "project" ? "border-accent-blue/40 text-accent-blue" : "border-border text-muted-foreground"}`}
                        >
                          {server.scope === "project" ? "Project" : "Global"}
                        </span>
                      </span>
                      <label
                        className={`flex items-center gap-1 text-[10px] text-muted-foreground shrink-0 ${toggleDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                        title={toggleTitle}
                      >
                        <input
                          type="checkbox"
                          checked={effectiveEnabled}
                          disabled={toggleDisabled}
                          onChange={e => handleToggle(e.target.checked)}
                          className="h-3 w-3"
                        />
                        {effectiveEnabled ? "Enabled" : isExcludedHere ? "Excluded" : "Disabled"}
                      </label>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {server.mcp_url || "—"}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className={`text-[10px] ${text}`}>
                        {isTesting ? "Testing…" : getConnectionStatusLabel(server.health_status)}
                        {server.last_test_tool_count != null && server.health_status === "healthy" && (
                          <span className="text-muted-foreground"> · {server.last_test_tool_count} tools</span>
                        )}
                      </span>
                      <button
                        onClick={() => handleTest(server.id)}
                        disabled={isTesting}
                        className="text-[10px] text-accent-blue hover:underline disabled:opacity-50"
                      >
                        Test
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {errorMsg && (
            <div className="px-3 py-2 text-[11px] text-red-500 border-t border-border/60 bg-red-500/5">
              {errorMsg}
            </div>
          )}

          <div className="border-t border-border/60">
            {showAdd ? (
              <AddMcpForm
                allowScopeSelection={Boolean(repoId)}
                globalAtCap={globalAtCap}
                projectAtCap={projectAtCap}
                onCancel={() => setShowAdd(false)}
                onSubmit={async values => {
                  setErrorMsg(null)
                  try {
                    await createMcp(values)
                    setShowAdd(false)
                  } catch (e) {
                    setErrorMsg((e as Error).message)
                    throw e
                  }
                }}
              />
            ) : (
              <div className="flex items-center justify-between px-3 py-2">
                <button
                  onClick={() => !mcpAtCap && setShowAdd(true)}
                  disabled={mcpAtCap}
                  title={mcpAtCap ? `Max ${MAX_MCP_CONNECTIONS} enabled MCPs reached` : undefined}
                  className="text-[11px] text-accent-blue hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
                >
                  + Add MCP server{mcpAtCap ? " (at cap)" : ""}
                </button>
                <Link
                  href={scopedHref(scope, "/settings?tab=connections")}
                  onClick={closeMenu}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Manage in Settings →
                </Link>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function AddMcpForm({
  allowScopeSelection,
  globalAtCap,
  projectAtCap,
  onCancel,
  onSubmit,
}: {
  allowScopeSelection: boolean
  globalAtCap: boolean
  projectAtCap: boolean
  onCancel: () => void
  onSubmit: (values: CreateMcpInput) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [transport, setTransport] = useState<"http" | "sse">("http")
  const [authType, setAuthType] = useState<"none" | "api_key" | "bearer">("none")
  const [credentials, setCredentials] = useState("")
  const [scope, setScope] = useState<"global" | "project">(() => {
    if (!allowScopeSelection) return "global"
    // Prefer the scope that isn't already at cap so the default choice is
    // submittable; fall back to "project" when neither is full.
    if (projectAtCap && !globalAtCap) return "global"
    return "project"
  })
  const [saving, setSaving] = useState(false)

  const selectedScopeAtCap =
    (allowScopeSelection ? scope : "global") === "global"
      ? globalAtCap
      : projectAtCap
  const canSubmit =
    name.trim() &&
    url.trim() &&
    (authType === "none" || credentials.trim()) &&
    !selectedScopeAtCap

  const handleSubmit = async () => {
    if (!canSubmit || saving) return
    setSaving(true)
    try {
      await onSubmit({
        name: name.trim(),
        mcp_url: url.trim(),
        mcp_transport: transport,
        auth_type: authType,
        credentials: authType === "none" ? undefined : credentials.trim(),
        scope: allowScopeSelection ? scope : "global",
      })
      setName("")
      setUrl("")
      setCredentials("")
      setAuthType("none")
    } catch {
      // error surfaced by parent
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-3 space-y-2 bg-secondary/40">
      {allowScopeSelection ? (
        <div className="space-y-1">
          <div className="flex gap-3 text-[11px] text-muted-foreground">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="mcp-scope"
                checked={scope === "project"}
                onChange={() => setScope("project")}
                className="h-3 w-3"
              />
              This project
              {projectAtCap && (
                <span className="text-[9px] text-muted-foreground/80">(at cap)</span>
              )}
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="mcp-scope"
                checked={scope === "global"}
                onChange={() => setScope("global")}
                className="h-3 w-3"
              />
              Global
              {globalAtCap && (
                <span className="text-[9px] text-muted-foreground/80">(at cap)</span>
              )}
            </label>
          </div>
          {selectedScopeAtCap && (
            <div className="text-[10px] text-amber-400">
              {scope === "global"
                ? `Max ${MAX_MCP_CONNECTIONS} global MCPs reached.`
                : `Max ${MAX_MCP_CONNECTIONS} MCPs resolved for this repo.`}
            </div>
          )}
        </div>
      ) : (
        <div className="text-[10px] text-muted-foreground">
          Creating in <span className="text-foreground">Global</span> scope.
          {globalAtCap && (
            <span className="ml-1 text-amber-400">
              Max {MAX_MCP_CONNECTIONS} reached.
            </span>
          )}
        </div>
      )}
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Name (e.g. Supabase)"
        className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
      />
      <input
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="https://mcp.example.com/sse"
        className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
      />
      <div className="flex gap-2">
        <select
          value={transport}
          onChange={e => setTransport(e.target.value as "http" | "sse")}
          className="flex-1 px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
        >
          <option value="http">HTTP</option>
          <option value="sse">SSE</option>
        </select>
        <select
          value={authType}
          onChange={e => setAuthType(e.target.value as "none" | "api_key" | "bearer")}
          className="flex-1 px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
        >
          <option value="none">No auth</option>
          <option value="api_key">API Key</option>
          <option value="bearer">Bearer</option>
        </select>
      </div>
      {authType !== "none" && (
        <input
          value={credentials}
          onChange={e => setCredentials(e.target.value)}
          type="password"
          placeholder={authType === "api_key" ? "API key" : "Bearer token"}
          className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
        />
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || saving}
          className="px-2 py-1 text-[11px] rounded border border-accent-blue text-accent-blue hover:bg-accent-blue/10 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Add"}
        </button>
      </div>
    </div>
  )
}
