import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveEffectiveSandboxBillingMode } from "@/lib/sandbox/billing";
import {
  applyResourceOwnerScope,
  buildResourceOwnershipInsert,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";
import {
  DEFAULT_SANDBOX_IDLE_TIMEOUT_MS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
  normalizeSandboxIdleTimeoutMs,
  normalizeSandboxTimeoutMs,
} from "@/lib/repo-settings";
import type { SandboxBillingMode } from "@/lib/sandbox/billing";

export const DEFAULT_WORKSPACE_NAME = "Imported Repos";
export const DEFAULT_WORKSPACE_DESCRIPTION =
  "Auto-created to organize synced GitHub repos.";
export const WORKSPACE_COLUMNS =
  "id, user_id, owner_type, owner_user_id, product_team_id, created_by_user_id, name, description, is_default, sandbox_billing_mode, sandbox_timeout_ms, sandbox_idle_timeout_ms, sandbox_vercel_team_id, sandbox_vercel_project_id, vercel_link_status, vercel_link_checked_at, vercel_link_error_code, vercel_link_message, created_at, updated_at";

export type WorkspaceRecord = {
  id: string;
  user_id: string;
  owner_type: "user" | "team";
  owner_user_id: string | null;
  product_team_id: string | null;
  created_by_user_id: string | null;
  name: string;
  description: string | null;
  is_default: boolean;
  sandbox_billing_mode: SandboxBillingMode;
  sandbox_timeout_ms: number;
  sandbox_idle_timeout_ms: number | null;
  sandbox_vercel_team_id: string | null;
  sandbox_vercel_project_id: string | null;
  vercel_link_status:
    | "unknown"
    | "valid"
    | "missing_project"
    | "auth_invalid"
    | "inaccessible";
  vercel_link_checked_at: string | null;
  vercel_link_error_code: string | null;
  vercel_link_message: string | null;
  created_at: string;
  updated_at: string;
};

export function normalizeWorkspaceName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function normalizeWorkspaceDescription(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getOwnedWorkspace<T = { id: string }>(
  workspaceId: string,
  userId: string,
  select = "id"
): Promise<T | null> {
  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .select(select)
    .eq("id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load workspace ${workspaceId}: ${error.message}`
    );
  }

  return (data as T | null) ?? null;
}

export async function getWorkspaceForScope<T = { id: string }>(
  workspaceId: string,
  scope: ProductResourceScope,
  select = "id"
): Promise<T | null> {
  let query = supabaseAdmin
    .from("workspaces")
    .select(select)
    .eq("id", workspaceId);
  query = applyResourceOwnerScope(query, scope);
  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load workspace ${workspaceId}: ${error.message}`
    );
  }

  return (data as T | null) ?? null;
}

export async function ensureDefaultWorkspaceForUser(
  userId: string,
  options?: {
    name?: string;
    description?: string | null;
    productTeamId?: string | null;
  }
): Promise<WorkspaceRecord> {
  const scope: ProductResourceScope = options?.productTeamId
    ? {
        kind: "team",
        userId,
        productTeamId: options.productTeamId,
      }
    : {
        kind: "personal",
        userId,
        productTeamId: null,
      };

  let existingQuery = supabaseAdmin
    .from("workspaces")
    .select(WORKSPACE_COLUMNS)
    .eq("is_default", true);
  existingQuery = applyResourceOwnerScope(existingQuery, scope);
  const { data: existing, error: existingError } =
    await existingQuery.maybeSingle();

  if (existingError) {
    throw new Error(
      `Failed to load default workspace: ${existingError.message}`
    );
  }

  if (existing) {
    return existing as WorkspaceRecord;
  }

  const payload = {
    ...buildResourceOwnershipInsert(scope),
    name: normalizeWorkspaceName(options?.name) || DEFAULT_WORKSPACE_NAME,
    description:
      normalizeWorkspaceDescription(options?.description) ??
      DEFAULT_WORKSPACE_DESCRIPTION,
    is_default: true,
    sandbox_billing_mode: "platform" as const,
    sandbox_timeout_ms: DEFAULT_SANDBOX_TIMEOUT_MS,
    sandbox_idle_timeout_ms: DEFAULT_SANDBOX_IDLE_TIMEOUT_MS,
    sandbox_vercel_team_id: null,
    sandbox_vercel_project_id: null,
  };

  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .insert(payload)
    .select(WORKSPACE_COLUMNS)
    .single();

  if (!error && data) {
    return data as WorkspaceRecord;
  }

  if (error?.code === "23505") {
    let retryQuery = supabaseAdmin
      .from("workspaces")
      .select(WORKSPACE_COLUMNS)
      .eq("is_default", true);
    retryQuery = applyResourceOwnerScope(retryQuery, scope);
    const { data: retry, error: retryError } = await retryQuery.single();

    if (retryError) {
      throw new Error(
        `Failed to load default workspace after retry: ${retryError.message}`
      );
    }

    return retry as WorkspaceRecord;
  }

  throw new Error(
    `Failed to create default workspace: ${error?.message || "unknown error"}`
  );
}

export function normalizeWorkspaceSettings(input: {
  name?: unknown;
  description?: unknown;
  sandbox_billing_mode?: unknown;
  sandbox_timeout_ms?: unknown;
  sandbox_idle_timeout_ms?: unknown;
  sandbox_vercel_team_id?: unknown;
  sandbox_vercel_project_id?: unknown;
}) {
  return {
    name: normalizeWorkspaceName(input.name),
    description: normalizeWorkspaceDescription(input.description),
    sandbox_billing_mode: resolveEffectiveSandboxBillingMode({
      workspaceBillingModeInput: input.sandbox_billing_mode,
    }),
    sandbox_timeout_ms: normalizeSandboxTimeoutMs(input.sandbox_timeout_ms),
    sandbox_idle_timeout_ms: normalizeSandboxIdleTimeoutMs(
      input.sandbox_idle_timeout_ms
    ),
    sandbox_vercel_team_id: null,
    sandbox_vercel_project_id: null,
  };
}
