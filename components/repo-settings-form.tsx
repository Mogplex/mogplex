"use client";

import { useState } from "react";
import type { Repo } from "@/lib/types";
import {
  DEFAULT_DEV_PORT,
  DEFAULT_ENV_SYNC_MODE,
  formatEnvVars,
  parseEnvVarsText,
} from "@/lib/repo-settings";
import {
  INHERITED_WORKSPACE_TEAM_OPTION,
  type SandboxBillingMode,
} from "@/lib/sandbox/billing";
import {
  buildRepoSandboxSettingsModel,
  buildRepoSandboxSettingsPayload,
  createRepoSandboxSettingsDraft,
  resolveRepoTeamSelectionDraft,
} from "@/lib/sandbox/settings-model";
import { useVercelTargets } from "@/hooks/use-vercel-targets";
import { useUser } from "@/hooks/use-user";
import {
  SUPPORTED_RUNTIMES,
  RUNTIME_LABELS,
} from "@/lib/sandbox/runtimes/types";
import { VercelLinkedProjectValidationBanner } from "@/components/vercel-linked-project-validation-banner";
import { derivePersistedVercelLinkedProjectValidation } from "@/lib/vercel/validation";

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
    repo.env_sync_mode || DEFAULT_ENV_SYNC_MODE
  );
  const [vercelTeamId, setVercelTeamId] = useState(
    createRepoSandboxSettingsDraft(repo).vercelTeamId
  );
  const [vercelProjectId, setVercelProjectId] = useState(
    createRepoSandboxSettingsDraft(repo).vercelProjectId
  );
  const { user } = useUser();
  const accountDefaultProjectId = user?.account_vercel_project_id ?? null;
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
    vercelTeamId,
    vercelProjectId,
  };
  const baseSandboxModel = buildRepoSandboxSettingsModel(repo, draft);
  const matchesStoredDraft =
    billingModeOverride === (repo.sandbox_billing_mode_override || "inherit") &&
    vercelTeamId === (repo.vercel_team_id || "") &&
    vercelProjectId === (repo.vercel_project_id || "");
  const initialLinkedProjectValidation =
    matchesStoredDraft &&
    baseSandboxModel.effectiveBillingMode === "user_vercel_project"
      ? billingModeOverride === "user_vercel_project"
        ? derivePersistedVercelLinkedProjectValidation({
            status: repo.vercel_link_status,
            source: "repo",
            message: repo.vercel_link_message,
            errorCode: repo.vercel_link_error_code,
          })
        : baseSandboxModel.effectiveLinkedProjectSource === "repo"
          ? derivePersistedVercelLinkedProjectValidation({
              status: repo.vercel_link_status,
              source: "repo",
              message: repo.vercel_link_message,
              errorCode: repo.vercel_link_error_code,
            })
          : baseSandboxModel.effectiveLinkedProjectSource === "workspace"
            ? derivePersistedVercelLinkedProjectValidation({
                status: repo.workspace?.vercel_link_status,
                source: "workspace",
                message: repo.workspace?.vercel_link_message,
                errorCode: repo.workspace?.vercel_link_error_code,
              })
            : null
      : null;
  const {
    teams,
    projects,
    loadingTargets,
    creatingProject,
    targetsError,
    needsVercelReconnect,
    linkedProjectValidation,
    createProject,
  } = useVercelTargets({
    teamScope: baseSandboxModel.teamScope,
    reconnectMessage:
      "Link Personal Vercel to choose your own billing project or sync envs from a linked project.",
    initialValidation: initialLinkedProjectValidation,
    validation: {
      billingMode: baseSandboxModel.effectiveBillingMode,
      source: baseSandboxModel.effectiveLinkedProjectSource,
      projectId: baseSandboxModel.effectiveLinkedProjectId,
      teamId: baseSandboxModel.effectiveLinkedTeamId,
    },
  });
  const sandboxModel = buildRepoSandboxSettingsModel(repo, draft, teams);

  const createProjectDefaultName = (
    repo.name ||
    repo.full_name.split("/")[1] ||
    "mogplex-sandbox"
  ).trim();
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

  const handleCreateProject = async () => {
    const result = await createProject(createProjectDefaultName);
    if (result.ok) {
      setVercelProjectId(result.project.id);
      setVercelTeamId(result.teamId === "personal" ? "" : result.teamId);
    }
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
            Inherit workspace default (
            {sandboxModel.workspaceBillingMode === "user_vercel_project"
              ? "Your Vercel project"
              : "Mogplex billing"}
            )
          </option>
          <option value="platform">Mogplex billing</option>
          <option value="user_vercel_project">
            Your Vercel project billing
          </option>
        </select>
        <p className="text-muted-foreground text-[11px]">
          Effective owner: {sandboxModel.effectiveOwnerLabel}.
        </p>
      </label>

      <label className="space-y-1">
        <div className="ui-label">Repo-linked Vercel Team</div>
        <select
          aria-label="Repo-linked Vercel Team"
          value={sandboxModel.selectedTeamValue}
          onChange={(e) => {
            const next = resolveRepoTeamSelectionDraft(e.target.value, draft);
            setVercelTeamId(next.vercelTeamId);
            setVercelProjectId(next.vercelProjectId);
          }}
          className="border-border bg-input text-foreground w-full border px-2 py-1 disabled:opacity-50"
          disabled={loadingTargets}
        >
          <option value="personal">Personal</option>
          {sandboxModel.usingWorkspaceTeam ? (
            <option value={INHERITED_WORKSPACE_TEAM_OPTION}>
              Inherit workspace team ({sandboxModel.inheritedTeamName})
            </option>
          ) : null}
          {teams
            .filter((team) => team.id !== "personal")
            .map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
        </select>
      </label>

      <label className="space-y-1">
        <div className="ui-label">Repo-linked Vercel Project</div>
        <select
          aria-label="Repo-linked Vercel Project"
          value={vercelProjectId}
          onChange={(e) => setVercelProjectId(e.target.value)}
          className="border-border bg-input text-foreground w-full border px-2 py-1"
          disabled={loadingTargets}
        >
          {/* Falls back to the raw project ID when the account-default project is
              not in the currently-scoped team's list (loading, or different team). */}
          <option value="">
            {accountDefaultProjectId
              ? `Use account default (${
                  projects.find((p) => p.id === accountDefaultProjectId)
                    ?.name ?? accountDefaultProjectId
                })`
              : "No repo-specific project"}
          </option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
              {project.framework ? ` (${project.framework})` : ""}
            </option>
          ))}
        </select>
        <div className="text-muted-foreground flex items-center justify-between gap-3 text-[11px]">
          <span>
            Used when this repo links its own Vercel project for user billing or
            env sync, and overrides the workspace billing project for this repo.{" "}
            {sandboxModel.effectiveLinkedProjectId
              ? `Current effective project: ${sandboxModel.effectiveLinkedProjectId}.`
              : "No effective Vercel project is configured yet."}
            {sandboxModel.usingWorkspaceTeam
              ? ` Available projects are being loaded from the inherited workspace team (${sandboxModel.inheritedTeamName}).`
              : ""}
            {sandboxModel.pinsInheritedWorkspaceTeam
              ? " Saving a repo-specific project here will also pin the inherited workspace team to this repo."
              : ""}
          </span>
          <button
            type="button"
            onClick={() => void handleCreateProject()}
            disabled={loadingTargets || creatingProject}
            className="border-border text-foreground shrink-0 border px-2 py-1 disabled:opacity-50"
          >
            {creatingProject
              ? "Creating..."
              : `Create ${createProjectDefaultName}`}
          </button>
        </div>
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
          <option value="vercel-project">Sync from Vercel project</option>
        </select>
        {envSyncMode === "vercel-project" && !vercelProjectId && (
          <p className="text-muted-foreground text-[11px]">
            Link a Vercel project above to enable env var syncing.
          </p>
        )}
      </label>

      {linkedProjectValidation && (
        <VercelLinkedProjectValidationBanner
          validation={linkedProjectValidation}
          className={mode === "page" ? "" : "md:col-span-2"}
        />
      )}

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
        <div className="ui-label">
          {envSyncMode === "vercel-project"
            ? "Manual Overrides"
            : "Environment Variables"}
        </div>
        {envSyncMode === "vercel-project" && (
          <p className="text-muted-foreground text-[11px]">
            These override Vercel project env vars when both define the same
            key.
          </p>
        )}
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

      {targetsError && linkedProjectValidation?.state !== "auth_invalid" && (
        <div
          className={`${mode === "page" ? "" : "md:col-span-2"} border-border text-muted-foreground border px-2 py-1.5 text-[11px]`}
        >
          {targetsError}
          {needsVercelReconnect ? (
            <>
              {" "}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- OAuth start endpoint, needs full-page navigation */}
              <a
                href="/api/auth/vercel"
                className="text-foreground underline underline-offset-2"
              >
                Reconnect Personal Vercel
              </a>
            </>
          ) : null}
        </div>
      )}

      <div
        className={`${mode === "page" ? "" : "md:col-span-2"} text-muted-foreground text-[11px] leading-5`}
      >
        Mogplex can bill sandbox usage to its own platform project or to a
        Vercel project you link from your personal account. User-owned billing
        never falls back silently: if you pick it without a valid personal
        Vercel link and project, sandbox launch will fail until the
        configuration is fixed.
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
