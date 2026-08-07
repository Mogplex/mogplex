"use client"

import { useState, useMemo, useCallback } from "react"
import useSWR from "swr"
import { fetchJsonObject } from "@/lib/client-fetch"
import { PROVIDER_META, type VerifyResult } from "./settings-types"

type ApiKeyEntry = {
  provider: string
  created_at: string
}

type ApiKeysData = {
  keys: ApiKeyEntry[]
}

export function ApiKeysSection({ platformAiEnabled }: { platformAiEnabled: boolean | null }) {
  const { data, mutate } = useSWR<ApiKeysData>(
    "/api/settings/keys",
    (url: string) => fetchJsonObject<ApiKeysData>(url, "Failed to load API keys"),
  )
  const keys = data?.keys || []
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [verifyResults, setVerifyResults] = useState<Record<string, VerifyResult>>({})

  const handleVerify = useCallback(async (provider: string) => {
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
  }, [])

  const configuredProviders = useMemo(() => new Set((data?.keys || []).map((k) => k.provider)), [data?.keys])

  const handleSave = useCallback(async (provider: string) => {
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
  }, [inputs, mutate])

  const handleDelete = useCallback(async (provider: string) => {
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
  }, [mutate])

  const dismissVerifyResult = useCallback((provider: string) => {
    setVerifyResults((prev) => {
      const next = { ...prev }
      delete next[provider]
      return next
    })
  }, [])

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
                          onClick={() => dismissVerifyResult(provider)}
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
