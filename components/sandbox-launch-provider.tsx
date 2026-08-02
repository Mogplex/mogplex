"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLaunchPresets } from "@/hooks/use-launch-presets";
import { useSandboxStore } from "@/hooks/use-sandbox";
import {
  SANDBOX_LAUNCH_PRESET_MAX_PER_REPO,
  type SandboxLaunchPreset,
} from "@/lib/launch-presets/shared";
import {
  hasConfiguredSandboxEnv,
  normalizeRootDirectory,
} from "@/lib/repo-settings";
import {
  buildSuggestedSandboxBranchName,
  isValidSandboxBranchName,
  isValidSandboxRootDirectory,
  normalizeSandboxBranchName,
  resolveSandboxLaunchPathChoice,
  SANDBOX_LAUNCH_PATH_CUSTOM_VALUE,
  SANDBOX_LAUNCH_PATH_REPO_ROOT_VALUE,
  type SandboxLaunchChoice,
} from "@/lib/sandbox/launch-config";
import {
  dispatchSandboxLaunchIntent,
  type SandboxLaunchOptions,
  type SandboxLaunchOutcome,
  type SandboxLaunchRepo,
} from "@/lib/sandbox/launch-intent";
import { cn } from "@/lib/utils";

type LaunchRepo = SandboxLaunchRepo;
type LaunchOptions = SandboxLaunchOptions;
type LaunchOutcome = SandboxLaunchOutcome;

type SandboxLaunchContextValue = {
  launchRepoSandbox: (
    repo: LaunchRepo,
    options: LaunchOptions
  ) => Promise<LaunchOutcome>;
};

type PendingLaunchPrompt = {
  repo: LaunchRepo;
  resolve: (choice: SandboxLaunchChoice | null) => void;
};

type WorkspaceOption = {
  path: string;
  label: string;
  framework?: string | null;
};

type WorkspaceFetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; workspaces: WorkspaceOption[] }
  | { status: "error" };

const REPO_ROOT_VALUE = SANDBOX_LAUNCH_PATH_REPO_ROOT_VALUE;
const CUSTOM_PATH_VALUE = SANDBOX_LAUNCH_PATH_CUSTOM_VALUE;

const SandboxLaunchContext = createContext<SandboxLaunchContextValue | null>(
  null
);

function LaunchOptionCard({
  active,
  title,
  detail,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  detail: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "rounded-lg border px-4 py-4 text-left transition-colors",
        active
          ? "text-foreground border-emerald-400/70 bg-emerald-400/8 ring-1 ring-emerald-300/20"
          : "border-border bg-card/70 text-muted-foreground hover:border-foreground/20 hover:bg-accent/30"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-foreground text-sm font-medium">{title}</div>
          <div className="text-muted-foreground mt-1 text-xs leading-5">
            {detail}
          </div>
        </div>
        <span
          className={cn(
            "mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[10px] font-medium tracking-[0.18em] uppercase",
            active
              ? "border-emerald-400/70 bg-emerald-400/12 text-emerald-300"
              : "border-border text-muted-foreground"
          )}
        >
          {active ? "On" : "Off"}
        </span>
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

function buildInitialPathSelection(repoDefault: string | null) {
  if (!repoDefault) return REPO_ROOT_VALUE;
  return repoDefault;
}

export function SandboxLaunchProvider({ children }: { children: ReactNode }) {
  const launch = useSandboxStore((state) => state.launch);
  const resumeSandbox = useSandboxStore((state) => state.resume);
  const listSandboxesForRepo = useSandboxStore(
    (state) => state.listSandboxesForRepo
  );
  const [pendingPrompt, setPendingPrompt] =
    useState<PendingLaunchPrompt | null>(null);
  const [launchMode, setLaunchMode] = useState<"default" | "new" | "workspace">(
    "default"
  );
  const [branchName, setBranchName] = useState("");
  const [branchError, setBranchError] = useState<string | null>(null);
  const [pathSelection, setPathSelection] = useState<string>(REPO_ROOT_VALUE);
  const [customPath, setCustomPath] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceFetchState>({
    status: "idle",
  });
  // Track the repo we've already kicked off a workspace fetch for so the
  // effect doesn't need workspaceState.status in its dep array. Listing
  // status there causes the effect to re-run on every transition
  // (idle → loading → ready/error) only to bail at the guard — wasted
  // renders and confusing for future readers.
  const fetchedWorkspacesForRepoIdRef = useRef<string | null>(null);
  const [presetSaveName, setPresetSaveName] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetSaving, setPresetSaving] = useState(false);
  const [showPresetSaveInput, setShowPresetSaveInput] = useState(false);
  // When a preset is applied, capture its base_branch so submit honours
  // the preset's literal-capture contract even if the repo's
  // default_branch later changes. Cleared on closePrompt and on any
  // launchMode/branchName change after the apply (so the user can
  // freely override the preset before submitting).
  const [presetAppliedBaseBranch, setPresetAppliedBaseBranch] = useState<
    string | null
  >(null);
  const launchPresets = useLaunchPresets(pendingPrompt?.repo.id ?? null);

  const closePrompt = useCallback((choice: SandboxLaunchChoice | null) => {
    setPendingPrompt((current) => {
      current?.resolve(choice);
      return null;
    });
    setLaunchMode("default");
    setBranchName("");
    setBranchError(null);
    setPathSelection(REPO_ROOT_VALUE);
    setCustomPath("");
    setPathError(null);
    setWorkspaceState({ status: "idle" });
    fetchedWorkspacesForRepoIdRef.current = null;
    setPresetSaveName("");
    setPresetError(null);
    setPresetSaving(false);
    setShowPresetSaveInput(false);
    setPresetAppliedBaseBranch(null);
  }, []);

  /**
   * Apply a saved preset's values to the current launch dialog state.
   * Mirrors the form-fill the user would have done by hand: branch
   * mode, working/base branch, path selection, custom-path input.
   *
   * Captures the preset's base_branch into presetAppliedBaseBranch so
   * the submit path honours the preset's literal-capture contract
   * even if the repo's default_branch has since changed. Cleared if
   * the user edits the branch name after applying.
   */
  const applyPreset = useCallback((preset: SandboxLaunchPreset) => {
    if (preset.create_branch) {
      setLaunchMode("new");
    } else {
      setLaunchMode("default");
    }
    setBranchName(preset.working_branch);
    setBranchError(null);
    setPresetAppliedBaseBranch(preset.base_branch);

    // Path: null = explicit repo root sentinel. Any string goes
    // through the custom-path branch — that always renders an
    // editable input the user can see, so we never end up with a
    // Select rendering a value that isn't in its item list (e.g.
    // when monorepo workspace detection hasn't completed yet).
    if (preset.root_directory === null) {
      setPathSelection(REPO_ROOT_VALUE);
      setCustomPath("");
    } else {
      setPathSelection(CUSTOM_PATH_VALUE);
      setCustomPath(preset.root_directory);
    }
    setPathError(null);
    setShowPresetSaveInput(false);
    setPresetError(null);
  }, []);

  const requestLaunchChoice = useCallback(
    (repo: LaunchRepo) => {
      return new Promise<SandboxLaunchChoice | null>((resolve) => {
        const hasExistingSandbox = listSandboxesForRepo(repo.id).length > 0;
        const repoDefault = normalizeRootDirectory(repo.root_directory);
        setLaunchMode(hasExistingSandbox ? "workspace" : "default");
        setBranchName(buildSuggestedSandboxBranchName(repo.full_name));
        setBranchError(null);
        setPathSelection(buildInitialPathSelection(repoDefault));
        setCustomPath(repoDefault ?? "");
        setPathError(null);
        setWorkspaceState({ status: "idle" });
        setPendingPrompt({ repo, resolve });
      });
    },
    [listSandboxesForRepo]
  );

  // Lazy-load detected monorepo workspaces when the dialog opens for a repo
  // flagged as a monorepo. We never block the dialog on this — if it fails
  // or the repo isn't a monorepo, the dropdown still has Repo root + custom
  // path as fallbacks.
  useEffect(() => {
    if (!pendingPrompt) return;
    if (!pendingPrompt.repo.is_monorepo) return;
    // Dedup via ref so the effect only fires once per opened dialog,
    // regardless of intermediate workspaceState transitions.
    if (fetchedWorkspacesForRepoIdRef.current === pendingPrompt.repo.id) {
      return;
    }
    fetchedWorkspacesForRepoIdRef.current = pendingPrompt.repo.id;

    let cancelled = false;
    setWorkspaceState({ status: "loading" });

    fetch(`/api/repos/${pendingPrompt.repo.id}/monorepo`, { method: "GET" })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: { workspaces?: WorkspaceOption[] }) => {
        if (cancelled) return;
        // Validate paths client-side too so the dropdown never shows an
        // entry the server would reject on submit. Server-side
        // isValidSandboxRootDirectory remains the real trust boundary;
        // this is defence-in-depth against a compromised API response or
        // a future bug in the monorepo detection endpoint.
        const workspaces = (data.workspaces ?? []).filter(
          (ws): ws is WorkspaceOption =>
            typeof ws.path === "string" &&
            ws.path.length > 0 &&
            isValidSandboxRootDirectory(ws.path)
        );
        setWorkspaceState({ status: "ready", workspaces });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Surface the failure shape so the team can distinguish a 404
        // (repo not found), a 403 (auth), a 500 (detection crash), or a
        // network error without needing to crack open devtools. The UI
        // still shows the generic "Couldn't detect workspaces" state.
        console.error("[sandbox-launch] monorepo workspace fetch failed", {
          repoId: pendingPrompt.repo.id,
          error,
        });
        setWorkspaceState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [pendingPrompt]);

  const launchRepoSandbox = useCallback(
    async (repo: LaunchRepo, options: LaunchOptions) => {
      return dispatchSandboxLaunchIntent(repo, options, {
        launch,
        resumeSandbox,
        requestLaunchChoice,
        getSandboxById(recordId) {
          return useSandboxStore.getState().getSandboxById(recordId);
        },
      });
    },
    [launch, requestLaunchChoice, resumeSandbox]
  );

  const contextValue = useMemo<SandboxLaunchContextValue>(
    () => ({
      launchRepoSandbox,
    }),
    [launchRepoSandbox]
  );

  const defaultBranch = pendingPrompt?.repo.default_branch?.trim() || "main";
  const repoDefaultPath = pendingPrompt
    ? normalizeRootDirectory(pendingPrompt.repo.root_directory)
    : null;
  const hasExistingSandbox = pendingPrompt
    ? listSandboxesForRepo(pendingPrompt.repo.id).length > 0
    : false;
  const showPathPicker = Boolean(pendingPrompt?.repo.is_monorepo);
  const showEnvWarning = pendingPrompt
    ? !hasConfiguredSandboxEnv(pendingPrompt.repo)
    : false;

  /**
   * Capture the dialog's current form state into a SandboxLaunchPreset
   * payload. Returns null when the form isn't a valid launch yet so
   * the caller can surface an error to the user instead of saving a
   * preset the live launch dialog would later reject.
   */
  const buildCurrentPresetPayload = useCallback(():
    | {
        ok: true;
        payload: {
          name: string;
          rootDirectory: string | null;
          baseBranch: string;
          workingBranch: string;
          createBranch: boolean;
        };
      }
    | { ok: false; error: string } => {
    if (!pendingPrompt) {
      return { ok: false, error: "Open the launch dialog first" };
    }
    const trimmedName = presetSaveName.trim();
    if (!trimmedName) {
      return { ok: false, error: "Name the preset before saving" };
    }

    const repoDefault = normalizeRootDirectory(
      pendingPrompt.repo.root_directory
    );

    let rootDirectory: string | null = null;
    if (showPathPicker) {
      const pathChoice = resolveSandboxLaunchPathChoice(
        pathSelection,
        customPath,
        repoDefault
      );
      if (!pathChoice.ok) {
        return { ok: false, error: pathChoice.error };
      }
      // Presets persist; collapse the three-way "undefined" override
      // into "null" so the saved row is unambiguous.
      rootDirectory = pathChoice.value ?? null;
    } else {
      rootDirectory = repoDefault;
    }

    const dialogDefaultBranch =
      pendingPrompt.repo.default_branch?.trim() || "main";
    // Mirror submit's effectiveBaseBranch so saving a preset right
    // after applying another preset preserves the literal base.
    const effectiveBaseBranch =
      presetAppliedBaseBranch ?? dialogDefaultBranch;

    if (launchMode === "default") {
      return {
        ok: true,
        payload: {
          name: trimmedName,
          rootDirectory,
          baseBranch: effectiveBaseBranch,
          workingBranch: effectiveBaseBranch,
          createBranch: false,
        },
      };
    }

    const normalizedBranch = normalizeSandboxBranchName(branchName);
    if (!normalizedBranch || !isValidSandboxBranchName(normalizedBranch)) {
      return {
        ok: false,
        error: "Use a valid git branch name before saving the preset",
      };
    }
    if (normalizedBranch === effectiveBaseBranch) {
      return {
        ok: false,
        error: "Pick a branch different from the base before saving",
      };
    }

    return {
      ok: true,
      payload: {
        name: trimmedName,
        rootDirectory,
        baseBranch: effectiveBaseBranch,
        workingBranch: normalizedBranch,
        createBranch: true,
      },
    };
  }, [
    branchName,
    customPath,
    launchMode,
    pathSelection,
    pendingPrompt,
    presetAppliedBaseBranch,
    presetSaveName,
    showPathPicker,
  ]);

  const handleSavePreset = useCallback(async () => {
    setPresetError(null);
    const built = buildCurrentPresetPayload();
    if (!built.ok) {
      setPresetError(built.error);
      return;
    }
    setPresetSaving(true);
    try {
      await launchPresets.savePreset(built.payload);
      setPresetSaveName("");
      setShowPresetSaveInput(false);
    } catch (error) {
      setPresetError(
        error instanceof Error ? error.message : "Failed to save preset"
      );
    } finally {
      setPresetSaving(false);
    }
  }, [buildCurrentPresetPayload, launchPresets]);

  const handleDeletePreset = useCallback(
    async (presetId: string) => {
      setPresetError(null);
      try {
        await launchPresets.deletePreset(presetId);
      } catch (error) {
        setPresetError(
          error instanceof Error ? error.message : "Failed to delete preset"
        );
      }
    },
    [launchPresets]
  );

  return (
    <SandboxLaunchContext.Provider value={contextValue}>
      {children}
      <Dialog
        open={Boolean(pendingPrompt)}
        onOpenChange={(open) => {
          if (!open) {
            closePrompt(null);
          }
        }}
      >
        <DialogContent className="border-border/80 bg-background/96 flex max-h-[calc(100vh-2rem)] max-w-xl flex-col overflow-hidden p-0 shadow-2xl backdrop-blur-sm">
          <div className="border-border/70 shrink-0 border-b px-6 py-5">
            <DialogHeader className="gap-2 text-left">
              <DialogTitle className="text-base">
                Start a new sandbox
              </DialogTitle>
              <DialogDescription className="text-xs leading-5">
                Choose how {pendingPrompt?.repo.full_name || "this repo"} should
                open. Use this when you want a clean slate — to keep working on
                an existing chat's branch, just reopen the chat.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            {pendingPrompt && launchPresets.presets.length > 0 ? (
              <div className="space-y-2">
                <div className="text-muted-foreground flex items-center justify-between text-[11px] tracking-[0.2em] uppercase">
                  <span>Saved Presets</span>
                  <span className="font-mono tracking-normal normal-case">
                    {launchPresets.presets.length}/
                    {SANDBOX_LAUNCH_PRESET_MAX_PER_REPO}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {launchPresets.presets.map((preset) => (
                    <div
                      key={preset.id}
                      className="border-border bg-card/70 hover:border-foreground/20 group flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className="text-foreground hover:text-foreground/90 max-w-[180px] truncate text-left"
                        title={`${preset.name} — ${preset.working_branch}${preset.root_directory ? ` · ${preset.root_directory}` : ""}`}
                      >
                        {preset.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeletePreset(preset.id)}
                        aria-label={`Delete preset ${preset.name}`}
                        className="text-muted-foreground/50 hover:text-destructive ml-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {showEnvWarning ? (
              <div
                role="status"
                className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] leading-5 text-amber-200"
              >
                <span className="font-medium">No env vars configured.</span>{" "}
                Your dev server may fail to boot. Add env vars in repo
                settings, or link a Vercel project to sync them automatically.
              </div>
            ) : null}

            {showPathPicker ? (
              <div className="space-y-2">
                <div className="text-muted-foreground flex items-center justify-between text-[11px] tracking-[0.2em] uppercase">
                  <span>Working Directory</span>
                  {repoDefaultPath ? (
                    <span className="font-mono tracking-normal normal-case">
                      Default: {repoDefaultPath}
                    </span>
                  ) : null}
                </div>
                <Select
                  value={pathSelection}
                  onValueChange={(value) => {
                    setPathSelection(value);
                    setPathError(null);
                  }}
                >
                  <SelectTrigger className="font-mono text-[12px]">
                    <SelectValue placeholder="Pick a working directory" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={REPO_ROOT_VALUE}>Repo root</SelectItem>
                    {workspaceState.status === "ready"
                      ? workspaceState.workspaces.map((ws) => (
                          <SelectItem
                            key={ws.path}
                            value={ws.path}
                            className="font-mono text-[12px]"
                          >
                            {ws.path}
                            {ws.framework ? ` · ${ws.framework}` : ""}
                          </SelectItem>
                        ))
                      : null}
                    <SelectItem
                      value={CUSTOM_PATH_VALUE}
                      className="font-mono text-[12px]"
                    >
                      Other path…
                    </SelectItem>
                  </SelectContent>
                </Select>
                {pathSelection === CUSTOM_PATH_VALUE ? (
                  <Input
                    value={customPath}
                    onChange={(event) => {
                      setCustomPath(event.target.value);
                      setPathError(null);
                    }}
                    placeholder="apps/web"
                    className="font-mono text-[12px]"
                  />
                ) : null}
                {workspaceState.status === "loading" ? (
                  <p className="text-muted-foreground text-[11px] leading-5">
                    Detecting workspaces…
                  </p>
                ) : null}
                {workspaceState.status === "error" ? (
                  <p className="text-muted-foreground text-[11px] leading-5">
                    Couldn't detect workspaces — pick a path manually if needed.
                  </p>
                ) : null}
                {pathError ? (
                  <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-[11px]">
                    {pathError}
                  </div>
                ) : null}
              </div>
            ) : null}

            {hasExistingSandbox ? (
              <LaunchOptionCard
                active={launchMode === "workspace"}
                title="New workspace from this repo"
                detail={`Open a sibling workspace on its own branch without touching your running sandbox. Base: ${defaultBranch}.`}
                onClick={() => {
                  // Clicks on the Input inside this card bubble to
                  // this onClick. Only clear the preset's captured
                  // base_branch when the launch mode is *actually*
                  // changing — clicking the input to position the
                  // cursor must not silently drop the preset's base.
                  if (launchMode !== "workspace") {
                    setPresetAppliedBaseBranch(null);
                  }
                  setLaunchMode("workspace");
                  setBranchError(null);
                }}
              >
                <div className="space-y-2">
                  <div className="text-muted-foreground flex items-center justify-between text-[11px] tracking-[0.2em] uppercase">
                    <span>Working Branch</span>
                    <span>Base: {defaultBranch}</span>
                  </div>
                  <Input
                    value={branchName}
                    onChange={(event) => {
                      setBranchName(event.target.value);
                      setBranchError(null);
                      // Branch edited by hand — release the preset's
                      // base_branch capture so submit doesn't keep
                      // using a stale base.
                      setPresetAppliedBaseBranch(null);
                    }}
                    onFocus={() => setLaunchMode("workspace")}
                    placeholder="mogplex/feature-branch"
                    className="font-mono text-[12px]"
                  />
                  <p className="text-muted-foreground text-[11px] leading-5">
                    Spawns in 5–10s when the repo has a baseline snapshot; falls
                    back to a fresh clone otherwise.
                  </p>
                </div>
              </LaunchOptionCard>
            ) : null}

            <LaunchOptionCard
              active={launchMode === "default"}
              title="Default Branch"
              detail={`Clone and work directly on ${defaultBranch}. Best when you intentionally want sandbox edits to stay on the repo default.`}
              onClick={() => {
                if (launchMode !== "default") {
                  setPresetAppliedBaseBranch(null);
                }
                setLaunchMode("default");
                setBranchError(null);
              }}
            />

            <LaunchOptionCard
              active={launchMode === "new"}
              title="Create New Branch"
              detail={`Clone ${defaultBranch}, create a fresh working branch, and push it upstream before the sandbox boots.`}
              onClick={() => {
                if (launchMode !== "new") {
                  setPresetAppliedBaseBranch(null);
                }
                setLaunchMode("new");
                setBranchError(null);
              }}
            >
              <div className="space-y-2">
                <div className="text-muted-foreground flex items-center justify-between text-[11px] tracking-[0.2em] uppercase">
                  <span>Working Branch</span>
                  <span>Base: {defaultBranch}</span>
                </div>
                <Input
                  value={branchName}
                  onChange={(event) => {
                    setBranchName(event.target.value);
                    setBranchError(null);
                    setPresetAppliedBaseBranch(null);
                  }}
                  onFocus={() => setLaunchMode("new")}
                  placeholder="mogplex/feature-branch"
                  className="font-mono text-[12px]"
                />
                <p className="text-muted-foreground text-[11px] leading-5">
                  Mogplex will create the branch inside the sandbox and push it
                  to GitHub so restarts stay on the same branch.
                </p>
              </div>
            </LaunchOptionCard>

            {branchError ? (
              <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-[11px]">
                {branchError}
              </div>
            ) : null}

            {pendingPrompt ? (
              <div className="border-border/70 border-t pt-4">
                {showPresetSaveInput ? (
                  <div className="space-y-2">
                    <div className="text-muted-foreground flex items-center justify-between text-[11px] tracking-[0.2em] uppercase">
                      <span>Save Current As Preset</span>
                      {launchPresets.presets.length >=
                      SANDBOX_LAUNCH_PRESET_MAX_PER_REPO ? (
                        <span className="text-destructive normal-case tracking-normal">
                          Cap reached ({SANDBOX_LAUNCH_PRESET_MAX_PER_REPO})
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        autoFocus
                        value={presetSaveName}
                        onChange={(event) => {
                          setPresetSaveName(event.target.value);
                          setPresetError(null);
                        }}
                        placeholder="e.g. apps/web on staging"
                        maxLength={64}
                        className="h-8 text-[12px]"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleSavePreset()}
                        disabled={presetSaving || !presetSaveName.trim()}
                      >
                        {presetSaving ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setShowPresetSaveInput(false);
                          setPresetSaveName("");
                          setPresetError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                    {presetError ? (
                      <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-[11px]">
                        {presetError}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setShowPresetSaveInput(true);
                      setPresetError(null);
                    }}
                    className="text-muted-foreground hover:text-foreground text-[11px] underline-offset-2 hover:underline"
                  >
                    Save current as preset…
                  </button>
                )}
              </div>
            ) : null}
          </div>

          <DialogFooter className="border-border/70 shrink-0 border-t px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => closePrompt(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                // The path picker only renders for monorepo repos. For
                // non-monorepo repos we must NOT spread a path override
                // into the payload — doing so would send rootDirectory=null
                // (explicit repo root) and silently override
                // repos.root_directory for any single-target repo whose
                // settings configure a subdirectory.
                let resolvedPathOverride: string | null | undefined;
                if (showPathPicker) {
                  const pathChoice = resolveSandboxLaunchPathChoice(
                    pathSelection,
                    customPath,
                    repoDefaultPath
                  );
                  if (!pathChoice.ok) {
                    setPathError(pathChoice.error);
                    return;
                  }
                  resolvedPathOverride = pathChoice.value;
                } else {
                  resolvedPathOverride = undefined;
                }

                const pathPayload =
                  resolvedPathOverride === undefined
                    ? {}
                    : { rootDirectory: resolvedPathOverride };

                // Honour the preset's literal-capture contract: if a
                // preset was applied and the user hasn't overridden the
                // branch, use the preset's base_branch on submit even
                // if the repo's default_branch has since changed.
                // Otherwise fall back to the repo's current default.
                const effectiveBaseBranch =
                  presetAppliedBaseBranch ?? defaultBranch;

                if (launchMode === "default") {
                  closePrompt({
                    baseBranch: effectiveBaseBranch,
                    workingBranch: effectiveBaseBranch,
                    createBranch: false,
                    ...pathPayload,
                  });
                  return;
                }

                const normalizedBranch = normalizeSandboxBranchName(branchName);
                if (
                  !normalizedBranch ||
                  !isValidSandboxBranchName(normalizedBranch)
                ) {
                  setBranchError(
                    "Use a valid git branch name with letters, numbers, ., _, -, or /."
                  );
                  return;
                }
                if (normalizedBranch === effectiveBaseBranch) {
                  setBranchError(
                    "Pick a branch name different from the base branch."
                  );
                  return;
                }

                // Both "new" and "workspace" submit the same createBranch
                // payload; the backend path chooses snapshot vs git clone.
                closePrompt({
                  baseBranch: effectiveBaseBranch,
                  workingBranch: normalizedBranch,
                  createBranch: true,
                  ...pathPayload,
                });
              }}
            >
              Start Sandbox
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SandboxLaunchContext.Provider>
  );
}

export function useSandboxLaunchActions() {
  const context = useContext(SandboxLaunchContext);
  if (!context) {
    throw new Error(
      "useSandboxLaunchActions must be used inside SandboxLaunchProvider"
    );
  }
  return context;
}
