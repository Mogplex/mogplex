import { z } from "zod";
import {
  normalizeDevPortAuto,
  normalizeEnvVars,
  normalizeRepoSettingsPatch,
  resolveConfiguredDevPort,
  resolveEffectiveEnvSyncMode,
  type RepoEnvVars,
} from "@/lib/repo-settings";
import { REDACTED_VALUE, redactSecretsInText } from "@/lib/ai-telemetry";
import { getRepoForScope } from "@/lib/repos";
import { isValidSandboxRootDirectory } from "@/lib/sandbox/launch-config";
import { SUPPORTED_RUNTIMES } from "@/lib/sandbox/runtimes/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  hasCapability,
  resolveActiveTeamCapabilities,
  TEAM_RESOURCE_WRITE_CAPABILITY,
} from "@/lib/team-capabilities";
import {
  applyResourceOwnerScope,
  resolveProductResourceScopeForTeam,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";
import { ENV_NAME, isLoaderEnvName } from "./project-env-names";
import { defineTool } from "./shared";

/** The server-selected project a Control turn may configure. */
export type ProjectSettingsTarget = {
  userId: string;
  repoId: string;
  teamId?: string | null;
};

type ProjectSettingsDeps = {
  resolveTeam: typeof resolveActiveTeamCapabilities;
};

// Typed as string so the query builder does not parse the column list.
const SETTINGS_COLUMNS =
  "id,runtime,root_directory,install_command,dev_command,dev_port,dev_port_auto,env_sync_mode,sandbox_env_vars";

function logWriteError(action: string, repoId: string, error: unknown) {
  // Database messages can quote the row being written, which may hold
  // secrets, so log only the error code.
  const code = (error as { code?: unknown } | null)?.code;
  console.error(
    `[control/project-settings] ${action} failed for repo ${repoId}:`,
    typeof code === "string" ? code : "unknown error"
  );
}

type SettingsRow = {
  id: string;
  runtime: string | null;
  root_directory: string | null;
  install_command: string | null;
  dev_command: string | null;
  dev_port: number | null;
  dev_port_auto: boolean | null;
  env_sync_mode: string | null;
  sandbox_env_vars: RepoEnvVars | null;
};

/**
 * Resolve who owns the project: the operator's personal projects, or the
 * active team's. Any member may read; writing also needs the team's
 * project-write capability, the same rule the repos PATCH route applies.
 */
async function resolveScope(
  target: ProjectSettingsTarget,
  deps: ProjectSettingsDeps,
  access: "read" | "write"
): Promise<ProductResourceScope | { error: string }> {
  // Membership goes through the same resolver as the settings routes; the
  // capability is checked here so a missing one gets its own message.
  const resolution = await resolveProductResourceScopeForTeam({
    userId: target.userId,
    productTeamId: target.teamId,
    resolveActiveTeamCapabilities: deps.resolveTeam,
  });
  if (!resolution.ok) {
    return {
      error:
        resolution.status >= 500
          ? "Could not check your team access. Try again."
          : "You are not a member of this project's team.",
    };
  }
  if (
    access === "write" &&
    resolution.scope.kind === "team" &&
    !hasCapability(
      resolution.capabilities ?? new Set(),
      TEAM_RESOURCE_WRITE_CAPABILITY
    )
  ) {
    return { error: "You do not have permission to change this project." };
  }
  return resolution.scope;
}

/** Say which projects were searched, so a team/personal mix-up is fixable. */
function notFoundMessage(scope: ProductResourceScope) {
  return scope.kind === "team"
    ? "Project not found in the selected team. If it is a personal project or belongs to another team, switch to that scope and try again."
    : "Project not found in your personal projects. If it belongs to a team, select that team and try again.";
}

async function loadSettings(
  target: ProjectSettingsTarget,
  scope: ProductResourceScope
): Promise<SettingsRow | { error: string }> {
  try {
    const row = await getRepoForScope<SettingsRow>(
      target.repoId,
      scope,
      SETTINGS_COLUMNS
    );
    return row ?? { error: notFoundMessage(scope) };
  } catch (error) {
    console.error(
      `[control/project-settings] load failed for repo ${target.repoId}:`,
      // No code survives getRepoForScope's rethrow; redact the message.
      redactSecretsInText(
        error instanceof Error ? error.message : String(error)
      )
    );
    return { error: "Could not load project settings." };
  }
}

function shownCommand(command: string | null) {
  return command === null ? null : redactSecretsInText(command);
}

/** Settings as the agent sees them: env var names, never values. */
function describeSettings(row: SettingsRow) {
  return {
    runtime: row.runtime,
    rootDirectory: row.root_directory,
    // A saved command can carry an inline credential; it stays in the row.
    installCommand: shownCommand(row.install_command),
    devCommand: shownCommand(row.dev_command),
    // The same resolvers boot uses, so Control is told what boots apply.
    // devPort is null while boots detect the port.
    devPort: resolveConfiguredDevPort(row.dev_port, row.dev_port_auto),
    devPortAuto: normalizeDevPortAuto(row.dev_port_auto),
    envVarScope: resolveEffectiveEnvSyncMode(row.env_sync_mode),
    envVarNames: Object.keys(row.sandbox_env_vars ?? {}).sort(),
  };
}

// Commands read back through project_settings have credentials replaced by
// the redaction marker; saving one back would break every later boot.
const REDACTED_MARKER_MESSAGE = `Contains ${REDACTED_VALUE} from a read-back value. Omit the field, or write the command out in full.`;
const notRedacted = (value: string) => !value.includes(REDACTED_VALUE);
const savedCommand = z
  .string()
  .refine(notRedacted, { message: REDACTED_MARKER_MESSAGE });

const updateParams = z.object({
  runtime: z
    .enum(SUPPORTED_RUNTIMES)
    .nullable()
    .optional()
    .describe(
      "Sandbox image for future boots (takes effect on the next sandbox, not this one); null restores detection."
    ),
  installCommand: savedCommand
    .nullable()
    .optional()
    .describe("Command that installs dependencies; null restores detection."),
  devCommand: savedCommand
    .nullable()
    .optional()
    .describe("Command that starts the dev server; null restores detection."),
  devPort: z
    .number()
    .int()
    .min(1)
    .max(65_535)
    .nullable()
    .optional()
    .describe(
      "Port the dev server listens on; saving it turns off port detection. null turns detection back on; changing or clearing a pinned port needs replace: true."
    ),
  rootDirectory: z
    .string()
    .trim()
    // The same rule sandbox boot applies, so Control can save any directory
    // the operator could and none that boot would refuse.
    .refine(isValidSandboxRootDirectory, {
      message: "Use a path inside the repository, without '..'.",
    })
    .nullable()
    .optional()
    .describe("Repository-relative app directory; null for the repo root."),
  replace: z
    .boolean()
    .optional()
    .describe(
      "Required to change a saved install or dev command, or a pinned dev port, that is already set to something else. Use it only when the operator asked, or for a value you saved earlier in this conversation."
    ),
});

type SettingsUpdates = ReturnType<typeof normalizeRepoSettingsPatch>;

/**
 * Saved values this update would change: a set command, directory, runtime,
 * or pinned port being replaced or cleared. Filling an empty one is not.
 */
function replacedSettings(row: SettingsRow, updates: SettingsUpdates) {
  const replaced: Record<string, string | number | null> = {};
  const fields = [
    ["runtime", "runtime"],
    ["install_command", "installCommand"],
    ["dev_command", "devCommand"],
    ["root_directory", "rootDirectory"],
  ] as const;
  for (const [column, name] of fields) {
    if (!(column in updates)) continue;
    const saved = row[column];
    if (saved !== null && saved !== "" && saved !== updates[column])
      replaced[name] = shownCommand(saved);
  }
  if (pinnedPortReplaced(row, updates)) replaced.devPort = row.dev_port;
  return replaced;
}

/** Whether the update clears or changes a port the operator pinned. */
function pinnedPortReplaced(row: SettingsRow, updates: SettingsUpdates) {
  if (row.dev_port_auto !== false || row.dev_port === null) return false;
  return (
    updates.dev_port_auto === true ||
    (updates.dev_port !== undefined && updates.dev_port !== row.dev_port)
  );
}

/**
 * Replaced settings that need `replace: true`. Saved commands run on every
 * later boot, so this guard and the timeline entry for each save are what
 * stand between a mistaken or injected command and the next boot. Runtime and
 * root directory are closed, validated choices that setup itself has to
 * correct, so changing them only shows up in `replaced`.
 *
 * Filling an empty command is not guarded at all: getting a new project to
 * boot is what these tools exist for, and asking first would stall setup.
 * That first save is the case most likely to come from following a README,
 * and saved commands are the same kind of persisted hook as the env names
 * kept operator-only; the tradeoff is intended, and the timeline entry that
 * shows each saved command is the mitigation.
 *
 * `replace` is the model's assertion, not an enforced operator approval, for
 * these settings and for changing or deleting a stored variable alike. It
 * stops an accidental overwrite, not an injected one: an instruction in
 * repository content can include replace: true. That is a product decision: Control's project saves run without an approval
 * step, the same default as connection tools. What backs it is the guard
 * itself, the compare-and-swap, the redacted audit row, and a timeline entry
 * that names every replaced or deleted value and shows saved commands.
 */
const REPLACE_GUARDED = new Set(["installCommand", "devCommand", "devPort"]);

const envParams = z.object({
  name: z.string().describe("Variable name, e.g. NODE_ENV."),
  replace: z
    .boolean()
    .optional()
    .describe(
      "Required to change or delete a variable that is already set. Use it only for a variable you set earlier in this conversation or one the operator asked you to change; you cannot see stored values, which may be secrets."
    ),
  value: z
    .string()
    .min(1)
    .refine(notRedacted, { message: REDACTED_MARKER_MESSAGE })
    .nullable()
    .describe(
      "Non-secret value for the variable; null deletes it. An empty string is not accepted."
    ),
});

// A sibling call in the same step can win the compare-and-swap; each retry
// re-reads the row, so the guards run again and nothing is overwritten.
const ENV_SAVE_ATTEMPTS = 3;
const ENV_CONFLICT = Symbol("env-conflict");

type EnvWrite = { key: string; value: string | null; replace?: boolean };

/** One read-modify-write of the variable map, guarded by compare-and-swap. */
async function writeEnvVar(
  target: ProjectSettingsTarget,
  row: SettingsRow,
  scope: ProductResourceScope,
  { key, value, replace }: EnvWrite
) {
  const previous = row.sandbox_env_vars;
  // Copy stored values verbatim; only the key being written changes.
  const next: RepoEnvVars =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? { ...previous }
      : {};
  const exists = Object.hasOwn(next, key);
  if (value === null && !exists) {
    return {
      ok: true,
      name: key,
      unchanged: true,
      note: "The variable was not set.",
    };
  }
  // Control cannot see stored values, so changing or deleting one that
  // exists needs the operator's say-so.
  if (exists && !replace) {
    return {
      error: `${key} is already set and its value may be a secret. Ask the operator before ${value === null ? "deleting" : "changing"} it, then call again with replace: true.`,
    };
  }
  if (value === null) delete next[key];
  // Store it the way the operator's editor does (one surrounding quote pair
  // stripped), so later rewrites leave it unchanged.
  else next[key] = normalizeEnvVars({ [key]: value })[key];
  let query = supabaseAdmin
    .from("repos")
    .update({ sandbox_env_vars: next })
    .eq("id", target.repoId);
  query = applyResourceOwnerScope(query, scope);
  // Never overwrite an edit saved after our read.
  query =
    previous === null
      ? query.is("sandbox_env_vars", null)
      : query.eq("sandbox_env_vars", JSON.stringify(previous));
  const { data, error } = await query.select("id").maybeSingle();
  if (error) {
    logWriteError("env var save", target.repoId, error);
    return { error: "Could not save the variable." };
  }
  if (!data) return ENV_CONFLICT;
  return {
    ok: true,
    name: key,
    ...(value === null ? { deleted: true } : {}),
    ...(exists && value !== null ? { replaced: true } : {}),
    note: "New sandbox boots and new commands see the change; restart a running dev server to pick it up.",
  };
}

/**
 * Control tools that read and save the selected project's setup, so an
 * environment the agent got working boots that way next time.
 */
export function createProjectSettingsTools(
  target: ProjectSettingsTarget,
  overrides: Partial<ProjectSettingsDeps> = {}
) {
  const deps: ProjectSettingsDeps = {
    resolveTeam: overrides.resolveTeam ?? resolveActiveTeamCapabilities,
  };

  const withScope = async <T>(
    access: "read" | "write",
    run: (scope: ProductResourceScope) => Promise<T>
  ) => {
    const scope = await resolveScope(target, deps, access);
    if ("error" in scope) return scope;
    return run(scope);
  };

  const withRow = async <T>(
    access: "read" | "write",
    run: (row: SettingsRow, scope: ProductResourceScope) => Promise<T>
  ) =>
    withScope(access, async (scope) => {
      const row = await loadSettings(target, scope);
      if ("error" in row) return row;
      return run(row, scope);
    });

  return {
    project_settings: defineTool({
      description:
        "Read the selected project's saved setup: runtime, root directory, install and dev commands, dev port, and the names (never values) of its environment variables. Saved commands come back with any inline credential replaced by [redacted]; never save one back verbatim.",
      inputSchema: z.object({}),
      execute: async () =>
        withRow("read", async (row) => describeSettings(row)),
    }),
    project_settings_update: defineTool({
      description:
        "Save runtime, install command, dev command, dev port, or root directory for the selected project so future sandbox boots use them. Save only commands you ran successfully in the sandbox. Filling an empty setting, or changing the runtime or root directory, needs no confirmation; changing a saved install or dev command, or a pinned dev port, needs replace: true, which you pass only once the operator agrees.",
      inputSchema: updateParams,
      execute: async (input: z.infer<typeof updateParams>) =>
        withRow("write", async (row, scope) => {
          const updates = normalizeRepoSettingsPatch({
            ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
            ...(input.installCommand === undefined
              ? {}
              : { install_command: input.installCommand }),
            ...(input.devCommand === undefined
              ? {}
              : { dev_command: input.devCommand }),
            // A saved port only applies with auto-detection off; clearing it
            // turns detection back on and leaves the stored port unused.
            ...(input.devPort === undefined
              ? {}
              : input.devPort === null
                ? { dev_port_auto: true }
                : { dev_port: input.devPort, dev_port_auto: false }),
            ...(input.rootDirectory === undefined
              ? {}
              : { root_directory: input.rootDirectory }),
          });
          if (Object.keys(updates).length === 0) {
            return { error: "No settings to save." };
          }
          const replaced = replacedSettings(row, updates);
          const names = Object.keys(replaced).filter((name) =>
            REPLACE_GUARDED.has(name)
          );
          if (names.length > 0 && !input.replace) {
            return {
              error: `${names.join(", ")} already saved. Tell the operator what you would change and why; call again with replace: true only once they agree.`,
              saved: Object.fromEntries(
                names.map((name) => [name, replaced[name]])
              ),
            };
          }
          let query = supabaseAdmin
            .from("repos")
            .update(updates)
            .eq("id", target.repoId);
          query = applyResourceOwnerScope(query, scope);
          // Never overwrite a setting the operator saved after our read.
          for (const column of Object.keys(updates) as (keyof SettingsRow &
            keyof SettingsUpdates)[]) {
            const saved = row[column] ?? null;
            query =
              saved === null ? query.is(column, null) : query.eq(column, saved);
          }
          const { data, error } = await query
            .select(SETTINGS_COLUMNS)
            .maybeSingle();
          if (error) {
            logWriteError("settings update", target.repoId, error);
            return { error: "Could not save project settings." };
          }
          if (!data) {
            return {
              error: "Project settings changed while saving. Try again.",
            };
          }
          return {
            ok: true,
            settings: describeSettings(data as SettingsRow),
            ...(Object.keys(replaced).length > 0 ? { replaced } : {}),
          };
        }),
    }),
    project_env_set: defineTool({
      description:
        "Save one NON-SECRET environment variable (for example NODE_ENV, PORT, or a public URL) on the selected project, or delete one with value null. Never use it for passwords, API keys, tokens, or connection strings: ask the operator to add those in Project settings instead. Set one variable per call and wait for its result before the next.",
      inputSchema: envParams,
      execute: async ({ name, value, replace }: z.infer<typeof envParams>) => {
        const key = name.trim();
        if (!ENV_NAME.test(key) || key === "__proto__") {
          return { error: `${key || "That"} is not a valid variable name.` };
        }
        if (isLoaderEnvName(key)) {
          return {
            error: `${key} changes how every program in the sandbox starts. Ask the operator to set it in Project settings.`,
          };
        }
        // Quotes are stripped on save, so '""' would store an empty variable.
        if (value !== null && !normalizeEnvVars({ [key]: value })[key]) {
          return {
            error:
              "The value is empty once its surrounding quotes are removed. Use value: null to delete a variable.",
          };
        }
        return withScope("write", async (scope) => {
          for (let attempt = 1; ; attempt += 1) {
            const row = await loadSettings(target, scope);
            if ("error" in row) return row;
            const result = await writeEnvVar(target, row, scope, {
              key,
              value,
              replace,
            });
            if (result !== ENV_CONFLICT) return result;
            if (attempt === ENV_SAVE_ATTEMPTS) {
              return {
                error: "Project variables changed while saving. Try again.",
              };
            }
          }
        });
      },
    }),
  };
}
