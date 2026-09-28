import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MogplexApiErrorCode } from "./response";

// These are the same repository settings consumed by sandbox launch/resume.
// Reads expose keys only, never values. No Vercel project API is involved.
export type MogplexApiEnvVar = {
  id: string | null;
  key: string;
  target: string[];
  type: string;
  updatedAt: number | null;
};

export type MogplexApiEnvVarError = {
  code: MogplexApiErrorCode;
  message: string;
  status: number;
};

export type MogplexApiEnvVarResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: MogplexApiEnvVarError };

type EnvVarDeps = { client: SupabaseClient };
type RepoEnv = { sandbox_env_vars: Record<string, string> | null };

function envVarError(
  code: MogplexApiErrorCode,
  message: string,
  status: number
): MogplexApiEnvVarResult<never> {
  return { ok: false, error: { code, message, status } };
}

async function loadRepoEnv(
  userId: string,
  repoId: string,
  client: SupabaseClient
): Promise<MogplexApiEnvVarResult<RepoEnv>> {
  const { data, error } = await client
    .from("repos")
    .select("sandbox_env_vars")
    .eq("id", repoId)
    .eq("user_id", userId)
    .maybeSingle();
  // Do not propagate database diagnostics that could include secret parameters.
  if (error)
    return envVarError(
      "INTERNAL_ERROR",
      "Failed to load project environment variables",
      500
    );
  if (!data) return envVarError("NOT_FOUND", "Repository not found", 404);
  return { ok: true, data: data as RepoEnv };
}

async function saveRepoEnv(
  userId: string,
  repoId: string,
  previous: RepoEnv["sandbox_env_vars"],
  next: Record<string, string>,
  client: SupabaseClient
): Promise<MogplexApiEnvVarResult<null>> {
  let query = client
    .from("repos")
    .update({ sandbox_env_vars: next })
    .eq("id", repoId)
    .eq("user_id", userId);
  // Both the Neon shim and PostgREST compare JSONB values atomically. Never
  // overwrite a settings edit made after our read; let the caller retry.
  query =
    previous === null
      ? query.is("sandbox_env_vars", null)
      : query.eq("sandbox_env_vars", JSON.stringify(previous));
  const { data, error } = await query.select("id").maybeSingle();
  if (error)
    return envVarError(
      "INTERNAL_ERROR",
      "Failed to save project environment variables",
      500
    );
  if (!data)
    return envVarError(
      "CONFLICT",
      "Project environment variables changed. Retry the operation.",
      409
    );
  return { ok: true, data: null };
}

export async function listMogplexApiRepoEnvVars(
  userId: string,
  repoId: string,
  overrides: Partial<EnvVarDeps> = {}
): Promise<MogplexApiEnvVarResult<{ envVars: MogplexApiEnvVar[] }>> {
  const client = overrides.client ?? supabaseAdmin;
  const repo = await loadRepoEnv(userId, repoId, client);
  if (!repo.ok) return repo;
  return {
    ok: true,
    data: {
      envVars: Object.keys(repo.data.sandbox_env_vars ?? {})
        .sort()
        .map((key) => ({
          id: key,
          key,
          target: ["sandbox"],
          type: "sandbox",
          updatedAt: null,
        })),
    },
  };
}

export type UpsertMogplexApiRepoEnvVarInput = {
  key: string;
  value: string;
  // Retained for older REST/MCP clients; never silently reinterpret Vercel options.
  target?: string[];
  type?: string;
};

export async function upsertMogplexApiRepoEnvVar(
  userId: string,
  repoId: string,
  input: UpsertMogplexApiRepoEnvVarInput,
  overrides: Partial<EnvVarDeps> = {}
): Promise<
  MogplexApiEnvVarResult<{
    action: "created" | "updated";
    key: string;
    updatedCount: number;
  }>
> {
  if (input.target !== undefined || input.type !== undefined) {
    return envVarError(
      "BAD_REQUEST",
      "Mogplex project variables apply to sandboxes. Omit Vercel deployment target and type options.",
      400
    );
  }
  const client = overrides.client ?? supabaseAdmin;
  const repo = await loadRepoEnv(userId, repoId, client);
  if (!repo.ok) return repo;
  const previous = repo.data.sandbox_env_vars;
  const action = Object.hasOwn(previous ?? {}, input.key)
    ? "updated"
    : "created";
  const saved = await saveRepoEnv(
    userId,
    repoId,
    previous,
    { ...previous, [input.key]: input.value },
    client
  );
  if (!saved.ok) return saved;
  return {
    ok: true,
    data: { action, key: input.key, updatedCount: 1 },
  };
}

export async function deleteMogplexApiRepoEnvVar(
  userId: string,
  repoId: string,
  input: { key: string },
  overrides: Partial<EnvVarDeps> = {}
): Promise<MogplexApiEnvVarResult<{ key: string; deletedCount: number }>> {
  const client = overrides.client ?? supabaseAdmin;
  const repo = await loadRepoEnv(userId, repoId, client);
  if (!repo.ok) return repo;
  const previous = repo.data.sandbox_env_vars;
  if (!Object.hasOwn(previous ?? {}, input.key)) {
    return envVarError(
      "NOT_FOUND",
      "Project environment variable not found",
      404
    );
  }
  const next = { ...previous };
  delete next[input.key];
  const saved = await saveRepoEnv(userId, repoId, previous, next, client);
  if (!saved.ok) return saved;
  return {
    ok: true,
    data: { key: input.key, deletedCount: 1 },
  };
}
