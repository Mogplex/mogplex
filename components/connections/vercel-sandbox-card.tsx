"use client";

import { useEffect, useId, useState } from "react";
import { VercelFill } from "@/components/settings/icons";

type Phase = "idle" | "saving" | "deleting";

type Status = { type: "success" | "error"; message: string } | null;

type VercelSandboxCardProps = {
  isLinked: boolean;
  isLoading: boolean;
  onChanged: () => void;
};

export function VercelSandboxCard({
  isLinked,
  isLoading,
  onChanged,
}: VercelSandboxCardProps) {
  const [active, setActive] = useState(false);
  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<Status>(null);
  const inputId = useId();
  const saving = phase === "saving";
  const deleting = phase === "deleting";

  // Collapse the form when a concurrent SWR revalidation (or another tab)
  // flips us to linked while the add-form is still open. Otherwise a
  // stale `active=true` would silently re-expand the panel after a later
  // unlink, and the "Disconnect" button shown in the linked header could
  // fire against a token the user just saved elsewhere.
  //
  // This effect fires on every `isLinked` *transition*; a true→true SWR
  // revalidation (e.g. another tab re-links with no intervening false)
  // is skipped. That's not a gap in practice because the add-form is
  // only mountable while `!isLinked`, so any path that opens it implies
  // a subsequent false→true transition will fire this effect.
  //
  // We deliberately don't clear `status` here so the "Token saved."
  // success banner set by handleSave persists into the linked state
  // (it's cleared by the next user action — Disconnect or +Add).
  //
  // Disabling `set-state-in-effect` here is the documented escape hatch
  // for the "syncing state with an external prop" case: `isLinked` is
  // owned by the parent's SWR cache, a render-time ref-compare would
  // trigger `react-hooks/refs`, and a derived-state approach can't model
  // the user-driven `active` toggle.
  useEffect(() => {
    if (!isLinked) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActive(false);
    setToken("");
    setPhase("idle");
  }, [isLinked]);

  async function handleSave() {
    const trimmed = token.trim();
    if (!trimmed) return;
    setPhase("saving");
    setStatus(null);
    try {
      const response = await fetch("/api/auth/vercel/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ token: trimmed }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        setStatus({
          type: "error",
          message:
            data.message ||
            data.error ||
            "Failed to save Vercel token. Try again.",
        });
        setPhase("idle");
        return;
      }
      // Collapse the form and surface a success banner. We set `status`
      // last so it survives both the form-collapse and the
      // false→true `isLinked` effect (which deliberately doesn't touch
      // status). The banner clears on the next user action.
      setActive(false);
      setToken("");
      setPhase("idle");
      setStatus({ type: "success", message: "Token saved." });
      onChanged();
    } catch {
      setStatus({
        type: "error",
        message: "Network error while saving Vercel token. Try again.",
      });
      setPhase("idle");
    }
  }

  async function handleDisconnect() {
    setPhase("deleting");
    setStatus(null);
    try {
      const response = await fetch("/api/auth/vercel/token", {
        method: "DELETE",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setStatus({
          type: "error",
          message: data.error || "Failed to disconnect Vercel.",
        });
        setPhase("idle");
        return;
      }
      setPhase("idle");
      onChanged();
    } catch {
      setStatus({
        type: "error",
        message: "Network error while disconnecting Vercel.",
      });
      setPhase("idle");
    }
  }

  const stateLabel = isLoading
    ? "Loading..."
    : isLinked
      ? "Connected"
      : "Not configured";
  const stateTone =
    !isLoading && isLinked
      ? "border-accent-green/30"
      : "border-border";
  const labelTone =
    !isLoading && isLinked ? "text-accent-green" : "text-muted-foreground";

  return (
    <div
      data-testid="settings-sandbox-vercel"
      className={`border bg-background p-2.5 space-y-1 ${stateTone}`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <VercelFill
            size={16}
            className={`shrink-0 ${labelTone}`}
            aria-hidden="true"
          />
          <span className="text-xs text-foreground font-medium truncate">
            Vercel
          </span>
        </div>
        {isLinked ? (
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            disabled={deleting}
            className={`text-[11px] shrink-0 hover:underline ${labelTone} disabled:opacity-60`}
          >
            {deleting ? "..." : "Disconnect"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setActive((prev) => !prev);
              setStatus(null);
            }}
            className="text-[11px] text-accent-blue hover:underline shrink-0"
          >
            {active ? "Cancel" : "+ Add"}
          </button>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground leading-tight">
        Bills sandbox compute to your own Vercel account. Not used by agents.
      </div>
      {!isLoading && !active && (
        <div className={`text-[11px] leading-tight ${labelTone}`}>
          {stateLabel}
        </div>
      )}
      {status && !active && (
        <div
          className={`text-[11px] leading-tight ${status.type === "error" ? "text-destructive" : "text-accent-green"}`}
        >
          {status.message}
        </div>
      )}
      {active && !isLinked && (
        <div className="pt-1 space-y-1.5">
          <label htmlFor={inputId} className="sr-only">
            Vercel Personal Access Token
          </label>
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
              if (status?.type === "error") setStatus(null);
            }}
            placeholder="vercel_…"
            disabled={saving}
            className="w-full border border-border bg-input px-2 py-1 text-[11px] font-mono text-foreground disabled:opacity-50"
          />
          <div className="text-[11px] text-muted-foreground leading-tight">
            Generate one at{" "}
            <a
              href="https://vercel.com/account/tokens"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              vercel.com/account/tokens
            </a>{" "}
            with full access.
          </div>
          {status?.type === "error" && (
            <div className="text-[11px] text-destructive">{status.message}</div>
          )}
          <div className="flex items-center justify-between">
            <a
              href="https://vercel.com/docs/accounts/create-an-account#create-personal-access-token"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Docs
            </a>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!token.trim() || saving}
              className="px-3 py-1.5 text-[11px] bg-primary text-primary-foreground disabled:opacity-50"
            >
              {saving ? "..." : "Save token"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
