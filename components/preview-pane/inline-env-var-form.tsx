"use client";

import { useState } from "react";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { parseEnvText } from "./utils";

export function InlineEnvVarForm({
  repoId,
  onSaved,
}: {
  repoId: string;
  onSaved?: () => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const parsed = parseEnvText(text);
    if (!parsed) {
      setSaveError("Invalid format — use KEY=value lines");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // Merge with existing env vars so we don't wipe previously configured keys
      let existingEnvVars: Record<string, string> = {};
      const repoRes = await fetch(`/api/repos?id=${repoId}`, {
        headers: getActiveTeamRequestHeaders(),
      });
      if (repoRes.ok) {
        const repos = (await repoRes.json().catch(() => [])) as Array<{
          id: string;
          sandbox_env_vars?: unknown;
        }>;
        const current = repos.find((r) => r.id === repoId);
        if (
          current?.sandbox_env_vars &&
          typeof current.sandbox_env_vars === "object" &&
          !Array.isArray(current.sandbox_env_vars)
        ) {
          existingEnvVars = current.sandbox_env_vars as Record<string, string>;
        }
      }
      const merged = { ...existingEnvVars, ...parsed };
      const res = await fetch("/api/repos", {
        method: "PATCH",
        headers: getActiveTeamRequestHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ id: repoId, sandbox_env_vars: merged }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setSaveError(body.message ?? "Failed to save");
      } else {
        setSaved(true);
        onSaved?.();
      }
    } catch {
      setSaveError("Network error");
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="mt-2 text-[11px] text-red-300/70">
        Saved. Restarting preview…
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"MISSING_VAR=value\nANOTHER_VAR=value"}
        rows={3}
        className="w-full rounded border border-red-500/30 bg-black/20 px-2 py-1.5 font-mono text-[11px] text-red-100 placeholder:text-red-300/40 focus:ring-1 focus:ring-red-500/50 focus:outline-none"
      />
      {saveError && <div className="text-[10px] text-red-400">{saveError}</div>}
      <button
        onClick={() => void handleSave()}
        disabled={saving || !text.trim()}
        className="rounded border border-red-500/40 px-3 py-1 text-[11px] text-red-200 hover:bg-red-500/10 disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save & restart"}
      </button>
    </div>
  );
}
