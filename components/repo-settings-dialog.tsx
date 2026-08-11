"use client"

import { useState } from "react"
import type { Repo } from "@/lib/types"
import { RepoSettingsForm } from "./repo-settings-form"
import { RepoSecretsPanel } from "./repo-secrets-panel"
import { RepoSnapshotPanel } from "./repo-snapshot-panel"
import { RepoSkillsPanel } from "./repo-skills-panel"
import { RepoRulesPanel } from "./repo-rules-panel"
import { RepoModelsPanel } from "./repo-models-panel"

type DialogTab =
  | "settings"
  | "secrets"
  | "skills"
  | "rules"
  | "models"
  | "snapshot"

const TABS: { id: DialogTab; label: string }[] = [
  { id: "settings", label: "General" },
  { id: "secrets", label: "GitHub Secrets" },
  { id: "skills", label: "Skills" },
  { id: "rules", label: "Rules" },
  { id: "models", label: "Models" },
  { id: "snapshot", label: "Snapshot" },
]

interface Props {
  repo: Repo
  onClose: () => void
  onSave: (repo: Repo) => Promise<void>
  onRestart?: (repo: Repo) => Promise<void> | void
}

export function RepoSettingsDialog({ repo, onClose, onSave, onRestart }: Props) {
  const [tab, setTab] = useState<DialogTab>("settings")

  const handleSave = async (nextRepo: Repo) => {
    await onSave(nextRepo)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
      <div className="w-full max-w-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="ui-section-title">Space Settings</div>
            <div className="ui-meta">{repo.full_name}</div>
          </div>
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
            Close
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1 border-b border-border px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="max-h-[70vh] overflow-y-auto">
          {tab === "settings" && (
            <RepoSettingsForm repo={repo} onSave={handleSave} onClose={onClose} onRestart={onRestart} />
          )}
          {tab === "secrets" && <RepoSecretsPanel repo={repo} />}
          {tab === "skills" && <RepoSkillsPanel repo={repo} />}
          {tab === "rules" && <RepoRulesPanel repo={repo} />}
          {tab === "models" && <RepoModelsPanel repo={repo} />}
          {tab === "snapshot" && <RepoSnapshotPanel repo={repo} />}
        </div>
      </div>
    </div>
  )
}
