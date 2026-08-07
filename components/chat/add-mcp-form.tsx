"use client"
import { useState } from "react"
import type { CreateMcpInput } from "@/hooks/use-connections"
import { MAX_MCP_CONNECTIONS } from "@/lib/connections/constants"

export function AddMcpForm({
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
          {saving ? "Saving..." : "Add"}
        </button>
      </div>
    </div>
  )
}
