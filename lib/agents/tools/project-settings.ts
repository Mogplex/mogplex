import { z } from "zod";
import {
  normalizeEnvVars,
  normalizeRepoSettingsPatch,
  type RepoEnvVars,
} from "@/lib/repo-settings";
import { getRepoForScope } from "@/lib/repos";
import { SUPPORTED_RUNTIMES } from "@/lib/sandbox/runtimes/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  hasCapability,
  resolveActiveTeamCapabilities,
  TEAM_RESOURCE_WRITE_CAPABILITY,
} from "@/lib/team-capabilities";
import {
  applyResourceOwnerScope,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";
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
const ENV_NAME = /^[A-Za-z_]\w*$/;
// Names that change how every program in the sandbox starts. A value saved
// here re-arms on each boot, so only the operator may set these.
const LOADER_ENV_NAMES = new Set([
  "ALL_PROXY",
  "BASH_ENV",
  "CDPATH",
  "EDITOR",
  "ENV",
  "GIT_ASKPASS",
  "GIT_SSH_COMMAND",
  "GOFLAGS",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "JAVA_TOOL_OPTIONS",
  "JDK_JAVA_OPTIONS",
  "MAKEFLAGS",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PAGER",
  "PATH",
  "PERL5OPT",
  "PROMPT_COMMAND",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "RUBYOPT",
  "SHELL",
  "SSH_ASKPASS",
  "VISUAL",
  "_JAVA_OPTIONS",
]);
// Names compare upper-cased, so npm_config_* and http_proxy match too.
const LOADER_ENV_PREFIXES = ["LD_", "DYLD_", "NPM_CONFIG_", "GIT_CONFIG_"];

function isLoaderEnvName(name: string) {
  const upper = name.toUpperCase();
  return (
    LOADER_ENV_NAMES.has(upper) ||
    LOADER_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))
  );
}

function logWriteError(action: string, repoId: string, error: unknown) {
  console.error(
    `[control/project-settings] ${action} failed for repo ${repoId}:`,
    error instanceof Error
      ? error.message
      : ((error as { message?: unknown } | null)?.message ?? error)
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
  if (!target.teamId) {
    return { kind: "personal", userId: target.userId, productTeamId: null };
  }
  const team = await deps.resolveTeam(target.userId, target.teamId);
  if (!team.ok) {
    return {
      error:
        team.status >= 500
          ? "Could not check your team access. Try again."
          : "You are not a member of this project's team.",
    };
  }
  if (
    access === "write" &&
    !hasCapability(
      team.capabilities ?? new Set(),
      TEAM_RESOURCE_WRITE_CAPABILITY
    )
  ) {
    return { error: "You do not have permission to change this project." };
  }
  return { kind: "team", userId: target.userId, productTeamId: target.teamId };
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
    return row ?? { error: "Project not found." };
  } catch (error) {
    console.error(
      `[control/project-settings] load failed for repo ${target.repoId}:`,
      error instanceof Error ? error.message : error
    );
    return { error: "Could not load project settings." };
  }
}

/** Settings as the agent sees them: env var names, never values. */
function describeSettings(row: SettingsRow) {
  return {
    runtime: row.runtime,
    rootDirectory: row.root_directory,
    installCommand: row.install_command,
    devCommand: row.dev_command,
    // The port boots use; null while they detect it.
    devPort: row.dev_port_auto === false ? row.dev_port : null,
    devPortAuto: row.dev_port_auto !== false,
    envVarScope: row.env_sync_mode,
    envVarNames: Object.keys(row.sandbox_env_vars ?? {}).sort(),
  };
}

const updateParams = z.object({
  runtime: z
    .enum(SUPPORTED_RUNTIMES)
    .nullable()
    .optional()
    .describe(
      "Sandbox image for future boots (takes effect on the next sandbox, not this one); null restores detection."
    ),
  installCommand: z
    .string()
    .nullable()
    .optional()
    .describe("Command that installs dependencies; null restores detection."),
  devCommand: z
    .string()
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
      "Port the dev server listens on; saving it turns off port detection. null turns detection back on."
    ),
  rootDirectory: z
    .string()
    .nullable()
    .optional()
    .describe("Repository-relative app directory; null for the repo root."),
});

const envParams = z.object({
  name: z.string().describe("Variable name, e.g. NODE_ENV."),
  replace: z
    .boolean()
    .optional()
    .describe(
      "Required to change a variable that is already set. Use it only for a variable you set earlier in this conversation or one the operator asked you to change; you cannot see stored values, which may be secrets."
    ),
  value: z
    .string()
    .nullable()
    .describe("Non-secret value for the variable; null deletes it."),
});

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
        "Read the selected project's saved setup: runtime, root directory, install and dev commands, dev port, and the names (never values) of its environment variables.",
      inputSchema: z.object({}),
      execute: async () =>
        withRow("read", async (row) => describeSettings(row)),
    }),
    project_settings_update: defineTool({
      description:
        "Save runtime, install command, dev command, dev port, or root directory for the selected project so future sandbox boots use them. Save only commands you ran successfully in the sandbox.",
      inputSchema: updateParams,
      execute: async (input: z.infer<typeof updateParams>) =>
        withScope("write", async (scope) => {
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
          let query = supabaseAdmin
            .from("repos")
            .update(updates)
            .eq("id", target.repoId);
          query = applyResourceOwnerScope(query, scope);
          const { data, error } = await query
            .select(SETTINGS_COLUMNS)
            .maybeSingle();
          if (error) {
            logWriteError("settings update", target.repoId, error);
            return { error: "Could not save project settings." };
          }
          if (!data) return { error: "Project not found." };
          return { ok: true, settings: describeSettings(data as SettingsRow) };
        }),
    }),
    project_env_set: defineTool({
      description:
        "Save one NON-SECRET environment variable (for example NODE_ENV, PORT, or a public URL) on the selected project, or delete one with value null. Never use it for passwords, API keys, tokens, or connection strings: ask the operator to add those in Project settings instead.",
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
        return withRow("write", async (row, scope) => {
          const previous = row.sandbox_env_vars;
          const next = normalizeEnvVars(previous);
          let replaced = false;
          if (value === null) {
            if (!Object.hasOwn(next, key)) {
              return { ok: true, name: key, note: "The variable was not set." };
            }
            delete next[key];
          } else {
            if (Object.hasOwn(next, key) && !replace) {
              return {
                error: `${key} is already set and its value may be a secret. Ask the operator before changing it, then call again with replace: true.`,
              };
            }
            replaced = Object.hasOwn(next, key);
            next[key] = value;
          }
          let query = supabaseAdmin
            .from("repos")
            .update({ sandbox_env_vars: next })
            .eq("id", target.repoId);
          query = applyResourceOwnerScope(query, scope);
          // Never overwrite an edit the operator saved after our read.
          query =
            previous === null
              ? query.is("sandbox_env_vars", null)
              : query.eq("sandbox_env_vars", JSON.stringify(previous));
          const { data, error } = await query.select("id").maybeSingle();
          if (error) {
            logWriteError("env var save", target.repoId, error);
            return { error: "Could not save the variable." };
          }
          if (!data) {
            return {
              error: "Project variables changed while saving. Try again.",
            };
          }
          return {
            ok: true,
            name: key,
            ...(value === null ? { deleted: true } : {}),
            ...(replaced ? { replaced: true } : {}),
            note: "New sandbox boots and new commands see the change; restart a running dev server to pick it up.",
          };
        });
      },
    }),
  };
}
