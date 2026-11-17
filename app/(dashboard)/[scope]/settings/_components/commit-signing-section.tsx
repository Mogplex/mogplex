"use client"

import { useCallback, useState } from "react"
import useSWR from "swr"
import { fetchJsonObject } from "@/lib/client-fetch"

type CommitSigningStatus = {
  available: boolean
  configured: boolean
  publicKey: string | null
  fingerprint: string | null
  title: string | null
  registered: boolean
  registeredAt: string | null
  githubKeyId: string | null
  createdAt: string | null
}

const GITHUB_SIGNING_KEYS_URL =
  "https://github.com/settings/keys/new?type=signing"

async function loadStatus(url: string) {
  const payload = await fetchJsonObject(
    url,
    "Failed to load commit signing settings"
  )
  return payload as CommitSigningStatus
}

export function CommitSigningSection() {
  const { data, mutate } = useSWR(
    "/api/settings/commit-signing",
    loadStatus
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [importKey, setImportKey] = useState("")

  const post = useCallback(
    async (body: Record<string, unknown>, action: string) => {
      setBusy(action)
      setError(null)
      setNotice(null)
      try {
        const response = await fetch("/api/settings/commit-signing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string
          manualRegistrationRequired?: boolean
        }
        if (!response.ok) {
          setError(payload.error || "Commit signing request failed")
          if (payload.manualRegistrationRequired) {
            setNotice(
              "Add the public key to GitHub under Settings -> SSH and GPG keys -> Signing keys. Commits stay cryptographically signed either way; GitHub only shows the Verified badge once the key is registered."
            )
          }
          return
        }
        await mutate()
      } catch {
        setError("Network error while talking to the server")
      } finally {
        setBusy(null)
      }
    },
    [mutate]
  )

  const revoke = useCallback(async () => {
    setBusy("revoke")
    setError(null)
    setNotice(null)
    try {
      const response = await fetch("/api/settings/commit-signing", {
        method: "DELETE",
      })
      if (!response.ok) {
        setError("Could not revoke the signing key")
        return
      }
      await mutate()
    } catch {
      setError("Network error while talking to the server")
    } finally {
      setBusy(null)
    }
  }, [mutate])

  if (data && data.available === false) {
    return (
      <section className="rounded-lg border border-border/60 bg-card">
        <div className="px-5 pt-5 pb-2">
          <div className="ui-section-title">Commit Signing</div>
          <div className="ui-section-caption">
            Sign commits Mogplex makes on your behalf.
          </div>
        </div>
        <div className="px-5 pb-5">
          <div className="rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-5 text-amber-300">
            Commit signing is not configured on this deployment. Ask an
            administrator to set MOGPLEX_COMMIT_SIGNING_KEY_ENCRYPTION_KEY.
            Commits made in Mogplex are unsigned until then.
          </div>
        </div>
      </section>
    )
  }

  const configured = data?.configured === true

  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <div className="px-5 pt-5 pb-2">
        <div className="ui-section-title">Commit Signing</div>
        <div className="ui-section-caption">
          Sign commits Mogplex makes on your behalf with an SSH signing key.
          The private key is encrypted at rest and never leaves the platform.
        </div>
      </div>
      <div className="space-y-4 px-5 pb-5">
        {error && (
          <div className="px-2 py-1 text-sm text-destructive">
            {error}{" "}
            <button onClick={() => setError(null)} className="underline">
              Dismiss
            </button>
          </div>
        )}
        {notice && (
          <div className="rounded-md border border-border bg-background/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            {notice}
          </div>
        )}

        {configured ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                <div className="text-sm font-medium">
                  {data?.registered
                    ? "Signing key registered with GitHub"
                    : "Signing key ready"}
                </div>
                <div className="text-[11px] leading-5 text-muted-foreground">
                  {data?.registered
                    ? "Commits made in Mogplex show as Verified on GitHub."
                    : "Commits made in Mogplex are cryptographically signed. Register the public key with GitHub to get the Verified badge."}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={busy !== null || data?.registered === true}
                  onClick={() => post({ action: "register" }, "register")}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  Register with GitHub
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={revoke}
                  className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive disabled:opacity-50"
                >
                  Revoke
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">
                Public key
              </div>
              <code className="block w-full overflow-x-auto rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-[11px] leading-5 break-all">
                {data?.publicKey}
              </code>
              <div className="text-[11px] text-muted-foreground">
                Fingerprint {data?.fingerprint}
              </div>
              <a
                href={GITHUB_SIGNING_KEYS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-[11px] text-muted-foreground underline"
              >
                Add this key on GitHub
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-[11px] leading-5 text-muted-foreground">
              Mogplex can generate an Ed25519 signing key for you, or you can
              import an existing unencrypted OpenSSH private key. New keys
              apply to workspaces launched after they are saved.
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => post({ action: "generate" }, "generate")}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                {busy === "generate" ? "Generating…" : "Generate a signing key"}
              </button>
            </div>
            <details className="rounded-md border border-border">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
                Import an existing private key
              </summary>
              <div className="space-y-2 px-3 pb-3">
                <textarea
                  value={importKey}
                  onChange={(event) => setImportKey(event.target.value)}
                  rows={5}
                  spellCheck={false}
                  placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----"}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-[11px] leading-5"
                />
                <button
                  type="button"
                  disabled={busy !== null || importKey.trim().length === 0}
                  onClick={() =>
                    post({ action: "import", privateKey: importKey }, "import")
                  }
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  {busy === "import" ? "Importing…" : "Import private key"}
                </button>
              </div>
            </details>
          </div>
        )}
      </div>
    </section>
  )
}
