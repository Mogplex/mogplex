"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import useSWR from "swr"
import { ClientFetchError } from "@/lib/client-fetch"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog"
import { WorkspaceSigningCheck } from "./workspace-signing-check"

type CommitSigningStatus = {
  available: boolean
  configured: boolean
  publicKey: string | null
  fingerprint: string | null
  title: string | null
  registered: boolean
  registrationStatus?: "registered" | "not_registered" | "unavailable" | "not_connected"
  registeredAt: string | null
  githubKeyId: string | null
  createdAt: string | null
}

const GITHUB_SIGNING_KEYS_URL =
  "https://github.com/settings/ssh/new"

async function loadStatus(url: string) {
  const response = await fetch(url)
  const payload = await response.json().catch(() => null)
  if (response.status === 503 && payload?.available === false) return { available: false } as const
  if (!response.ok || !payload || typeof payload.available !== "boolean") {
    throw new ClientFetchError("Could not load commit signing settings. Try again.", response.status)
  }
  return payload as CommitSigningStatus
}

export function CommitSigningSection() {
  const { data, error: loadError, mutate } = useSWR(
    "/api/settings/commit-signing",
    loadStatus,
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  )
  const checkedKey = useRef<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [importKey, setImportKey] = useState("")
  const [confirmRemoval, setConfirmRemoval] = useState(false)

  const post = useCallback(
    async (body: Record<string, unknown>, action: string) => {
      const markCheckUnavailable = async () => {
        if (action === "check") await mutate(current => current?.available ? { ...current, registrationStatus: "unavailable" } : current, { revalidate: false })
      }
      setBusy(action)
      setError(null)
      setNotice(null)
      try {
        const response = await fetch("/api/settings/commit-signing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const payload = (await response.json().catch(() => ({}))) as CommitSigningStatus & {
          error?: string
          manualRegistrationRequired?: boolean
        }
        if (!response.ok) {
          await markCheckUnavailable()
          setError(payload.error || "Commit signing request failed")
          if (payload.manualRegistrationRequired) {
            setNotice(
              "Add the public key to GitHub under Settings -> SSH and GPG keys -> Signing keys. Commits stay cryptographically signed either way; GitHub only shows the Verified badge once the key is registered."
            )
          }
          return
        }
        setImportKey("")
        await mutate(payload, { revalidate: false })
      } catch {
        await markCheckUnavailable()
        setError("Network error while talking to the server")
      } finally {
        setBusy(null)
      }
    },
    [mutate]
  )

  const publicKey = data?.available ? data.publicKey : null
  useEffect(() => {
    if (!publicKey) { checkedKey.current = null; return }
    if (busy || checkedKey.current === publicKey) return
    checkedKey.current = publicKey
    void post({ action: "check" }, "check")
  }, [publicKey, busy, post])

  const revoke = useCallback(async () => {
    setBusy("revoke")
    setError(null)
    setNotice(null)
    try {
      const response = await fetch("/api/settings/commit-signing", {
        method: "DELETE",
      })
      if (!response.ok) {
        setError("Could not remove the signing key")
        return
      }
      setConfirmRemoval(false)
      setNotice("The stored key was removed. Existing workspaces may still contain it. Remove the signing key in GitHub to revoke its trust.")
      await mutate()
    } catch {
      setError("Network error while talking to the server")
    } finally {
      setBusy(null)
    }
  }, [mutate])

  if (!data || data.available === false || loadError) {
    return (
      <section className="rounded-lg border border-border/60 bg-card">
        <div className="px-5 pt-5 pb-2">
          <div className="ui-section-title">Commit Signing</div>
          <div className="ui-section-caption">
            Sign commits Mogplex makes on your behalf.
          </div>
        </div>
        <div className="px-5 pb-5">
          <div role={loadError ? "alert" : "status"} className="rounded-md border border-border bg-secondary px-3 py-2 text-sm leading-5 text-muted-foreground">
            {loadError
              ? "Could not load commit signing settings. Try again."
              : data?.available === false
                ? "Commit signing is not configured on this deployment. Contact your administrator to enable it."
                : "Loading commit signing settings…"}
            {loadError && <Button variant="outline" className="mt-3" onClick={() => void mutate()}>Try again</Button>}
          </div>
        </div>
      </section>
    )
  }

  const configured = data?.configured === true
  const githubNotConnected = data.registrationStatus === "not_connected"
  const registrationUnavailable = data.registrationStatus === "unavailable"

  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <div className="px-5 pt-5 pb-2">
        <div className="ui-section-title">Commit Signing</div>
        <div className="ui-section-caption">
          Sign commits Mogplex makes on your behalf with an SSH signing key.
          The private key is encrypted in storage and installed in your workspaces.
        </div>
      </div>
      <div className="space-y-4 px-5 pb-5">
        {error && (
          <div role="alert" className="px-2 py-1 text-sm text-destructive">
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">
                  Signing key saved
                </div>
                <div className="text-[11px] leading-5 text-muted-foreground">
                  Encrypted in storage. New and restarted workspaces receive this key.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== null || (data.registered && !registrationUnavailable && !githubNotConnected)}
                  onClick={() => post({ action: "register" }, "register")}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  Register with GitHub
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setConfirmRemoval(true)}
                  className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive disabled:opacity-50"
                >
                  Remove stored key
                </button>
              </div>
            </div>

            <div className="rounded-md border border-border bg-secondary px-3 py-2 text-sm">
              <p className="font-medium" role="status">{busy === "check" ? "Checking GitHub registration…" : githubNotConnected ? "Connect GitHub to check registration" : registrationUnavailable ? "GitHub registration could not be checked" : data.registered ? "Registered with GitHub" : "Not registered with GitHub"}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{githubNotConnected ? "Connect your GitHub account in Settings → Account, then check again. Your signing key is saved." : registrationUnavailable ? "Your signing key is saved. Check again to confirm whether GitHub trusts it." : data.registered ? "This public key is on your GitHub account as a signing key. A Verified badge also requires a matching commit email." : "Add this public key as a Signing Key on GitHub, then check its registration here."}</p>
              <Button variant="outline" size="sm" className="mt-3" disabled={busy !== null} onClick={() => void post({ action: "check" }, "check")}>{busy === "check" ? "Checking GitHub…" : "Check GitHub registration"}</Button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">Public key</span>
                <Button variant="outline" size="sm" onClick={async () => {
                  try { await navigator.clipboard.writeText(data.publicKey ?? ""); setNotice("Public key copied."); setError(null) }
                  catch { setError("Could not copy the public key. Select the key below and copy it manually.") }
                }}>Copy public key</Button>
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
              <div className="text-[11px] text-muted-foreground">
                Choose Signing Key on GitHub. Removing the stored key here does not revoke it on GitHub or erase existing workspace copies.
              </div>
            </div>
            <WorkspaceSigningCheck key={data.fingerprint} fingerprint={data.fingerprint} />
            <AlertDialog open={confirmRemoval} onOpenChange={open => { if (!busy) setConfirmRemoval(open) }}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this stored signing key?</AlertDialogTitle>
                  <AlertDialogDescription>Future workspaces will no longer receive this key. Existing workspaces may still contain a copy, and GitHub will continue trusting it until you remove it from your GitHub signing keys.</AlertDialogDescription>
                </AlertDialogHeader>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy !== null}>Keep key</AlertDialogCancel>
                  <Button variant="destructive" disabled={busy !== null} onClick={() => void revoke()}>{busy === "revoke" ? "Removing…" : "Confirm removal"}</Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
                  aria-label="OpenSSH private key"
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
