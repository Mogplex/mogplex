import { z } from "zod";
import {
  normalizeEnvVars,
  normalizeRepoSettingsPatch,
  type RepoEnvVars,
} from "@/lib/repo-settings";
import { getRepoForScope } from "@/lib/repos";
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
    devPort: row.dev_port,
    // When true, boots detect the port and ignore devPort.
    devPortAuto: row.dev_port_auto !== false,
    envVarScope: row.env_sync_mode,
    envVarNames: Object.keys(row.sandbox_env_vars ?? {}).sort(),
  };
}

const updateParams = z.object({
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
    .optional()
    .describe(
      "Port the dev server listens on; saving it turns off port detection."
    ),
  rootDirectory: z
    .string()
    .nullable()
    .optional()
    .describe("Repository-relative app directory; null for the repo root."),
});

const envParams = z.object({
  name: z.string().describe("Variable name, e.g. NODE_ENV."),
  value: z.string().describe("Non-secret value for the variable."),
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

  const withRow = async <T>(
    access: "read" | "write",
    run: (row: SettingsRow, scope: ProductResourceScope) => Promise<T>
  ) => {
    const scope = await resolveScope(target, deps, access);
    if ("error" in scope) return scope;
    const row = await loadSettings(target, scope);
    if ("error" in row) return row;
    return run(row, scope);
  };

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
        "Save install command, dev command, dev port, or root directory for the selected project so future sandbox boots use them. Save only commands you ran successfully in the sandbox.",
      inputSchema: updateParams,
      execute: async (input: z.infer<typeof updateParams>) =>
        withRow("write", async (_row, scope) => {
          const updates = normalizeRepoSettingsPatch({
            ...(input.installCommand === undefined
              ? {}
              : { install_command: input.installCommand }),
            ...(input.devCommand === undefined
              ? {}
              : { dev_command: input.devCommand }),
            // A saved port only applies with auto-detection off.
            ...(input.devPort === undefined
              ? {}
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
          if (error || !data)
            return { error: "Could not save project settings." };
          return { ok: true, settings: describeSettings(data as SettingsRow) };
        }),
    }),
    project_env_set: defineTool({
      description:
        "Save one NON-SECRET environment variable (for example NODE_ENV, PORT, or a public URL) on the selected project. Never use it for passwords, API keys, tokens, or connection strings: ask the operator to add those in Project settings instead.",
      inputSchema: envParams,
      execute: async ({ name, value }: z.infer<typeof envParams>) => {
        const key = name.trim();
        if (!ENV_NAME.test(key) || key === "__proto__") {
          return { error: `${key || "That"} is not a valid variable name.` };
        }
        return withRow("write", async (row, scope) => {
          const previous = row.sandbox_env_vars;
          const next = { ...normalizeEnvVars(previous), [key]: value };
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
          if (error) return { error: "Could not save the variable." };
          if (!data) {
            return {
              error: "Project variables changed while saving. Try again.",
            };
          }
          return {
            ok: true,
            name: key,
            note: "New sandbox boots and new commands get it; restart a running dev server to pick it up.",
          };
        });
      },
    }),
  };
}
