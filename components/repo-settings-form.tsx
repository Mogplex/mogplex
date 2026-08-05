"use client";

import { useState } from "react";
import type { Repo } from "@/lib/types";
import {
  DEFAULT_DEV_PORT,
  DEFAULT_ENV_SYNC_MODE,
  formatEnvVars,
  resolveEffectiveEnvSyncMode,
  parseEnvVarsText,
} from "@/lib/repo-settings";
import type { SandboxBillingMode } from "@/lib/sandbox/billing";
import {
  buildRepoSandboxSettingsPayload,
  createRepoSandboxSettingsDraft,
} from "@/lib/sandbox/settings-model";
import {
  SUPPORTED_RUNTIMES,
  RUNTIME_LABELS,
} from "@/lib/sandbox/runtimes/types";

interface Props {
  repo: Repo;
  onSave: (repo: Repo) => Promise<void>;
  onClose?: () => void;
  onRestart?: (repo: Repo) => Promise<void> | void;
  mode?: "dialog" | "page";
}

export function RepoSettingsForm({
  repo,
  onSave,
  onClose,
  onRestart,
  mode = "dialog",
}: Props) {
  const [runtime, setRuntime] = useState(repo.runtime || "");
  const [defaultBranch, setDefaultBranch] = useState(
    repo.default_branch || "main"
  );
  const [billingModeOverride, setBillingModeOverride] = useState<
    "inherit" | SandboxBillingMode
  >(createRepoSandboxSettingsDraft(repo).billingModeOverride);
  const [envSyncMode, setEnvSyncMode] = useState(
    resolveEffectiveEnvSyncMode(repo.env_sync_mode || DEFAULT_ENV_SYNC_MODE)
  );
  const [rootDirectory, setRootDirectory] = useState(repo.root_directory || "");
  const [installCommand, setInstallCommand] = useState(
    repo.install_command || ""
  );
  const [devCommand, setDevCommand] = useState(repo.dev_command || "");
  const [devPortAuto, setDevPortAuto] = useState(repo.dev_port_auto ?? true);
  const [devPort, setDevPort] = useState(
    String(repo.dev_port || DEFAULT_DEV_PORT)
  );
  const [envVarsText, setEnvVarsText] = useState(
    formatEnvVars(repo.sandbox_env_vars)
  );
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = {
    billingModeOverride,
    vercelTeamId: "",
    vercelProjectId: "",
  };
  const buildRepo = () => {
    const sandboxEnvVars = parseEnvVarsText(envVarsText);
    return {
      ...repo,
      runtime: runtime || null,
      default_branch: defaultBranch.trim() || "main",
      ...buildRepoSandboxSettingsPayload(repo, draft),
      env_sync_mode: envSyncMode,
      root_directory: rootDirectory.trim() || null,
      install_command: installCommand.trim() || null,
      dev_command: devCommand.trim() || null,
      dev_port: Number(devPort),
      dev_port_auto: devPortAuto,
      sandbox_env_vars: sandboxEnvVars,
    } satisfies Repo;
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await onSave(buildRepo());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save repo settings"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRestart = async () => {
    if (!onRestart) return;
    setError(null);
    setRestarting(true);
    try {
      await onRestart(buildRepo());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to restart sandbox"
      );
    } finally {
      setRestarting(false);
    }
  };

  const wrapperClass =
    mode === "page" ? "space-y-4" : "grid gap-4 p-4 md:grid-cols-2";

  return (
    <div className={wrapperClass}>
      <label className="space-y-1">
        <div className="ui-label">Launch Branch</div>
        <input
          value={defaultBranch}
          onChange={(e) => setDefaultBranch(e.target.value)}
          className="border-border bg-input text-foreground w-full border px-2 py-1"
          placeholder="main"
        />
      </label>

      <label className="space-y-1">
        <div className="ui-label">Runtime</div>
        <select
          value={runtime}
          onChange={(e) => setRuntime(e.target.value)}
          className="border-border bg-input text-foreground w-full border px-2 py-1"
        >
          <option value="">Auto-detect</option>
          {SUPPORTED_RUNTIMES.map((rt) => (
            <option key={rt} value={rt}>
              {RUNTIME_LABELS[rt]}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1">
        <div className="ui-label">Sandbox Billing</div>
        <select
          aria-label="Sandbox Billing"
          value={billingModeOverride}
          onChange={(e) =>
            setBillingModeOverride(
              e.target.value as "inherit" | SandboxBillingMode
            )
          }
          className="border-border bg-input text-foreground w-full border px-2 py-1"
        >
          <option value="inherit">
            Inherit workspace default (Mogplex billing)
          </option>
          <option value="platform">Mogplex billing</option>
        </select>
        <p className="text-muted-foreground text-[11px]">
          Sandboxes use Mogplex billing. User-owned Vercel compute is not yet
          available.
        </p>
      </label>

      <label className="space-y-1">
        <div className="ui-label">Env Mapping</div>
        <select
          value={envSyncMode}
          onChange={(e) => setEnvSyncMode(e.target.value as typeof envSyncMode)}
          className="border-border bg-input text-foreground w-full border px-2 py-1"
        >
          <option value="sandbox-only">Sandbox only</option>
          <option value="sandbox-and-preview">
            Sandbox + preview conventions
          </option>
        </select>
        <p className="text-muted-foreground text-[11px]">
          Vercel project import is unavailable with Sign in with Vercel. Add
          sandbox variables manually below.
        </p>
      </label>

      <label className="space-y-1">
        <div className="ui-label">Root Directory</div>
        <input
          value={rootDirectory}
          onChange={(e) => setRootDirectory(e.target.value)}
          className="border-border bg-input text-foreground w-full border px-2 py-1"
          placeholder="apps/web"
        />
      </label>

      <label className="space-y-1">
        <div className="ui-label">Install Command</div>
        <input
          value={installCommand}
          onChange={(e) => setInstallCommand(e.target.value)}
          className="border-border bg-input text-foreground w-full border px-2 py-1"
          placeholder="pnpm install"
        />
      </label>

      <label className="space-y-1">
        <div className="ui-label">Dev Command</div>
        <input
          value={devCommand}
          onChange={(e) => setDevCommand(e.target.value)}
          className="border-border bg-input text-foreground w-full border px-2 py-1"
          placeholder="pnpm dev"
        />
      </label>

      <label className="space-y-1">
        <div className="ui-label">Dev Port</div>
        <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
          <input
            checked={devPortAuto}
            onChange={(e) => setDevPortAuto(e.target.checked)}
            type="checkbox"
          />
          <span>Auto-detect from runtime/framework</span>
        </div>
        <input
          value={devPort}
          onChange={(e) => setDevPort(e.target.value)}
          className="border-border bg-input text-foreground w-full border px-2 py-1 disabled:opacity-50"
          inputMode="numeric"
          placeholder="3000"
          disabled={devPortAuto}
        />
      </label>

      <label className={`space-y-1 ${mode === "page" ? "" : "md:col-span-2"}`}>
        <div className="ui-label">Environment Variables</div>
        <textarea
          value={envVarsText}
          onChange={(e) => setEnvVarsText(e.target.value)}
          className="border-border bg-input text-foreground min-h-40 w-full border px-2 py-1"
          placeholder={"NODE_ENV=development\nAPI_BASE_URL=https://example.com"}
        />
        <p className="text-muted-foreground text-[11px]">
          Paste `.env`-style `KEY=value` lines. Surrounding single or double
          quotes are stripped automatically.
        </p>
      </label>

      <div
        className={`${mode === "page" ? "" : "md:col-span-2"} text-muted-foreground text-[11px] leading-5`}
      >
        Sandboxes use the Mogplex platform project. User-owned Vercel compute
        requires a future API-capable integration and is not available.
      </div>

      {error && (
        <div
          className={`${mode === "page" ? "" : "md:col-span-2"} border-destructive text-destructive border px-2 py-1.5 text-[11px]`}
        >
          {error}
        </div>
      )}

      <div
        className={`${mode === "page" ? "" : "md:col-span-2"} border-border flex items-center justify-end gap-2 border-t pt-3`}
      >
        {onClose && (
          <button
            onClick={onClose}
            className="border-border text-muted-foreground hover:text-foreground border px-3 py-1"
          >
            Cancel
          </button>
        )}
        {onRestart && (
          <button
            onClick={handleRestart}
            disabled={saving || restarting}
            className="border-border text-foreground border px-3 py-1 disabled:opacity-50"
          >
            {restarting ? "Restarting..." : "Restart Sandbox"}
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving || restarting}
          className="border-border bg-primary text-primary-foreground border px-3 py-1 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
