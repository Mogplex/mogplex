"use client";

import { useState } from "react";
import { Plus, Trash } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_ENV_SYNC_MODE,
  resolveEffectiveEnvSyncMode,
  type EnvSyncMode,
} from "@/lib/repo-settings";
import {
  createEnvVarRow,
  envVarsFromRows,
  mergePastedEnv,
  rowsFromEnvVars,
  type EnvVarRow,
} from "@/lib/project-settings/env-var-rows";
import type { Repo } from "@/lib/types";

const SCOPE_OPTIONS: { value: EnvSyncMode; label: string }[] = [
  { value: "sandbox-only", label: "Sandbox only" },
  { value: "sandbox-and-preview", label: "Sandbox + preview conventions" },
];

/**
 * Key/value editor for a project's sandbox environment variables. Values are
 * masked until revealed; the scope applies to every variable in the project.
 */
export function EnvVarsPanel({
  repo,
  onSave,
}: {
  repo: Repo;
  onSave: (repo: Repo) => Promise<void>;
}) {
  const [rows, setRows] = useState(() => rowsFromEnvVars(repo.sandbox_env_vars));
  const [scope, setScope] = useState<EnvSyncMode>(() =>
    resolveEffectiveEnvSyncMode(repo.env_sync_mode || DEFAULT_ENV_SYNC_MODE)
  );
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateRow = (id: string, patch: Partial<EnvVarRow>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );

  const importPaste = () => {
    try {
      setRows((current) => mergePastedEnv(current, pasteText));
      setPasteText("");
      setPasteOpen(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read .env text");
    }
  };

  const save = async () => {
    const result = envVarsFromRows(rows);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({
        ...repo,
        env_sync_mode: scope,
        sandbox_env_vars: result.vars,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save environment variables"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <label className="block space-y-1">
        <span className="ui-label">Scope</span>
        <select
          aria-label="Variable scope"
          value={scope}
          onChange={(event) => setScope(event.target.value as EnvSyncMode)}
          className="border-border bg-secondary text-foreground h-9 w-full rounded border px-2 text-sm"
        >
          {SCOPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground block text-[11px]">
          Applies to every variable in this project when its sandbox starts.
        </span>
      </label>

      <div role="group" aria-label="Environment variables" className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No variables yet. Add one or paste a .env file.
          </p>
        ) : null}
        {rows.map((row, index) => (
          <div key={row.id} className="flex items-center gap-2">
            <Input
              aria-label={`Variable ${index + 1} name`}
              value={row.key}
              onChange={(event) => updateRow(row.id, { key: event.target.value })}
              placeholder="KEY"
              className="w-2/5 font-mono text-xs"
            />
            <PasswordInput
              label={`${row.key.trim() || `variable ${index + 1}`} value`}
              value={row.value}
              onChange={(event) =>
                updateRow(row.id, { value: event.target.value })
              }
              placeholder="value"
              containerClassName="flex-1"
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${row.key.trim() || `variable ${index + 1}`}`}
              onClick={() =>
                setRows((current) => current.filter((item) => item.id !== row.id))
              }
            >
              <Trash aria-hidden className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows((current) => [...current, createEnvVarRow()])}
        >
          <Plus aria-hidden className="size-4" />
          Add variable
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={pasteOpen}
          onClick={() => setPasteOpen((current) => !current)}
        >
          Paste .env
        </Button>
      </div>

      {pasteOpen ? (
        <div className="space-y-2">
          <Textarea
            aria-label="Paste .env contents"
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder={"API_URL=https://example.com\nTOKEN=..."}
            className="min-h-32 font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={importPaste}>
              Import
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPasteOpen(false)}
            >
              Cancel
            </Button>
          </div>
          <p className="text-muted-foreground text-[11px]">
            Existing names take the pasted value; new names are added. Quotes
            around values are stripped.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}

      <div className="border-border flex justify-end border-t pt-3">
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save variables"}
        </Button>
      </div>
    </div>
  );
}
